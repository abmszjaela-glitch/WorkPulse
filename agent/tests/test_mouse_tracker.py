"""Verify counts and lifecycle using fake listeners, without hooking real input."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from agent.tracker.activity_state import ActivityState
from agent.tracker.mouse_tracker import MouseTracker


class FakeListener:
    def __init__(self, **callbacks):
        self.callbacks = callbacks
        self.alive = False
        self.stuck = False
        self.join_calls = 0

    def start(self):
        self.alive = True

    def stop(self):
        if not self.stuck:
            self.alive = False

    def join(self, timeout=None):
        self.join_calls += 1

    def is_alive(self):
        return self.alive


class MouseTrackerTests(unittest.TestCase):
    def setUp(self):
        self.listeners = []

        def create_listener(**callbacks):
            listener = FakeListener(**callbacks)
            self.listeners.append(listener)
            return listener

        self.patch = patch(
            "agent.tracker.mouse_tracker.mouse.Listener", side_effect=create_listener
        )
        self.factory = self.patch.start()
        self.addCleanup(self.patch.stop)
        self.activity = ActivityState()
        self.tracker = MouseTracker(self.activity)
        self.addCleanup(self.tracker.stop)

    def test_counts_and_shared_timestamp_without_input_details(self):
        self.tracker.start()
        callbacks = self.listeners[-1].callbacks
        with patch("agent.tracker.activity_state.monotonic", return_value=123.0):
            callbacks["on_move"](110, 220)
            callbacks["on_click"](330, 440, object(), True)
        self.assertEqual(self.activity.last_activity, 123.0)
        with patch("agent.tracker.activity_state.monotonic", return_value=124.0):
            callbacks["on_click"](550, 660, object(), False)
        self.assertEqual(self.tracker.last_activity, 124.0)
        self.assertEqual(
            self.tracker.get_counts(), {"movement_count": 1, "click_count": 1}
        )
        self.assertIs(self.tracker.activity_state, self.activity)
        self.assertFalse(any("coordinate" in key for key in vars(self.tracker)))

    def test_safe_stop_before_start_and_idempotent_lifecycle(self):
        self.tracker.stop()
        self.assertFalse(self.tracker.is_running)
        self.tracker.start()
        self.tracker.start()
        self.assertEqual(self.factory.call_count, 1)
        self.assertTrue(self.tracker.is_running)
        self.tracker.stop()
        self.tracker.stop()
        self.assertFalse(self.tracker.is_running)
        self.assertEqual(self.listeners[0].join_calls, 1)
        self.tracker.start()
        self.assertEqual(self.factory.call_count, 2)

    def test_callbacks_after_stop_are_ignored(self):
        self.tracker.start()
        callbacks = self.listeners[-1].callbacks
        self.tracker.stop()
        before = self.activity.last_activity
        callbacks["on_move"](1, 2)
        callbacks["on_click"](1, 2, object(), True)
        self.assertEqual(self.tracker.movement_count, 0)
        self.assertEqual(self.tracker.click_count, 0)
        self.assertEqual(self.activity.last_activity, before)

    def test_concurrent_counts_and_atomic_reset(self):
        self.tracker.start()
        callbacks = self.listeners[-1].callbacks

        def record_batch(_):
            for _ in range(500):
                callbacks["on_move"](1, 2)
                callbacks["on_click"](1, 2, object(), True)
                callbacks["on_click"](1, 2, object(), False)

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(record_batch, range(8)))
        self.assertEqual(
            self.tracker.get_counts(reset=True),
            {"movement_count": 4000, "click_count": 4000},
        )
        self.assertEqual(
            self.tracker.get_counts(), {"movement_count": 0, "click_count": 0}
        )

    def test_shutdown_timeout_can_be_retried_without_recording(self):
        self.tracker.start()
        listener = self.listeners[-1]
        listener.stuck = True
        with self.assertRaises(TimeoutError):
            self.tracker.stop(timeout=0)
        listener.callbacks["on_move"](1, 2)
        self.assertEqual(self.tracker.movement_count, 0)
        with self.assertRaises(RuntimeError):
            self.tracker.start()
        listener.stuck = False
        self.tracker.stop(timeout=0)
        self.assertFalse(self.tracker.is_running)

    def test_stop_from_listener_thread_does_not_join_itself(self):
        self.tracker.start()
        listener = self.listeners[-1]
        with patch("agent.tracker.activity_tracker.current_thread", return_value=listener):
            self.tracker.stop()
        self.assertEqual(listener.join_calls, 0)

    def test_invalid_stop_timeouts(self):
        for timeout in (-1, float("inf"), float("nan")):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                self.tracker.stop(timeout)

    def test_multiple_trackers_share_timestamp_but_not_counts(self):
        other = MouseTracker(self.activity)
        self.addCleanup(other.stop)
        self.tracker.start()
        other.start()
        with patch("agent.tracker.activity_state.monotonic", return_value=456.0):
            self.listeners[-1].callbacks["on_move"](1, 2)
        self.assertEqual(self.tracker.last_activity, 456.0)
        self.assertEqual(self.tracker.movement_count, 0)
        self.assertEqual(other.movement_count, 1)

    def test_listener_start_failure_leaves_tracker_disabled(self):
        with patch.object(FakeListener, "start", side_effect=RuntimeError("Hook failed")):
            with self.assertRaisesRegex(RuntimeError, "Hook failed"):
                self.tracker.start()
        self.assertFalse(self.tracker.is_running)


if __name__ == "__main__":
    unittest.main()
