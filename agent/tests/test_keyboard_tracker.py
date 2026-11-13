"""Synthetic keyboard tests: no real keyboard listener is started."""

import gc
import io
import unittest
import weakref
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from agent.tracker.activity_state import ActivityState
from agent.tracker.keyboard_tracker import KeyboardTracker
from agent.tracker.mouse_tracker import MouseTracker
from test_mouse_tracker import FakeListener


class PrivateKey:
    """Fail if the tracker attempts to inspect or format individual input."""

    def __str__(self):
        raise AssertionError("Keys must not be converted to text")

    def __repr__(self):
        raise AssertionError("Keys must not be formatted")

    @property
    def char(self):
        raise AssertionError("Characters must not be read")

    @property
    def vk(self):
        raise AssertionError("Key codes must not be read")


class KeyboardTrackerTests(unittest.TestCase):
    def setUp(self):
        self.listeners = []

        def create_listener(**callbacks):
            listener = FakeListener(**callbacks)
            self.listeners.append(listener)
            return listener

        self.patch = patch(
            "agent.tracker.keyboard_tracker.keyboard.Listener",
            side_effect=create_listener,
        )
        self.factory = self.patch.start()
        self.addCleanup(self.patch.stop)
        self.activity = ActivityState()
        self.tracker = KeyboardTracker(self.activity)
        self.addCleanup(self.tracker.stop)

    def test_counts_only_and_refreshes_shared_timestamp(self):
        self.tracker.start()
        listener = self.listeners[-1]
        self.assertEqual(set(listener.callbacks), {"on_press"})
        with patch("agent.tracker.activity_state.monotonic", return_value=123.0):
            self.assertIsNone(listener.callbacks["on_press"](PrivateKey()))
        self.assertEqual(self.tracker.get_counts(), {"key_press_count": 1})
        self.assertEqual(self.activity.last_activity, 123.0)
        self.assertEqual(self.tracker.last_activity, 123.0)

    def test_key_is_not_retained_or_written_to_console_or_logs(self):
        self.tracker.start()
        callback = self.listeners[-1].callbacks["on_press"]
        key = PrivateKey()
        reference = weakref.ref(key)
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with patch("logging.Logger._log") as log:
                callback(key)
                log.assert_not_called()
        del key
        gc.collect()
        self.assertIsNone(reference())
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(self.tracker.get_counts(), {"key_press_count": 1})

    def test_concurrent_counts_and_atomic_snapshot_reset(self):
        self.tracker.start()
        callback = self.listeners[-1].callbacks["on_press"]

        def batch(_):
            for _ in range(500):
                callback(PrivateKey())

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(batch, range(8)))
        self.assertEqual(self.tracker.get_counts(reset=True), {"key_press_count": 4000})
        self.assertEqual(self.tracker.key_press_count, 0)

    def test_safe_stop_repeat_start_and_restart_preserve_counts(self):
        self.tracker.stop()
        self.tracker.start()
        self.tracker.start()
        self.assertEqual(self.factory.call_count, 1)
        self.listeners[-1].callbacks["on_press"](PrivateKey())
        self.tracker.stop()
        self.tracker.stop()
        self.assertFalse(self.tracker.is_running)
        self.tracker.start()
        self.assertEqual(self.factory.call_count, 2)
        self.assertEqual(self.tracker.key_press_count, 1)

    def test_late_events_after_stop_do_not_change_count_or_activity(self):
        self.tracker.start()
        callback = self.listeners[-1].callbacks["on_press"]
        self.tracker.stop()
        before = self.activity.last_activity
        callback(PrivateKey())
        self.assertEqual(self.tracker.key_press_count, 0)
        self.assertEqual(self.activity.last_activity, before)

    def test_keyboard_and_mouse_share_the_same_activity_state(self):
        mouse = MouseTracker(self.activity)
        with patch("agent.tracker.mouse_tracker.mouse.Listener", FakeListener):
            mouse.start()
        self.addCleanup(mouse.stop)
        self.tracker.start()
        with patch("agent.tracker.activity_state.monotonic", return_value=456.0):
            self.listeners[-1].callbacks["on_press"](PrivateKey())
        self.assertEqual(mouse.last_activity, 456.0)
        self.assertEqual(mouse.movement_count, 0)
        self.assertEqual(self.tracker.key_press_count, 1)

    def test_shutdown_timeout_can_be_retried(self):
        self.tracker.start()
        listener = self.listeners[-1]
        listener.stuck = True
        with self.assertRaises(TimeoutError):
            self.tracker.stop(timeout=0)
        listener.callbacks["on_press"](PrivateKey())
        self.assertEqual(self.tracker.key_press_count, 0)
        with self.assertRaises(RuntimeError):
            self.tracker.start()
        listener.stuck = False
        self.tracker.stop()

    def test_callback_failure_stops_without_logging_sensitive_exception(self):
        self.tracker.start()
        callback = self.listeners[-1].callbacks["on_press"]
        with patch.object(self.activity, "touch", side_effect=RuntimeError("private")):
            with patch("logging.Logger._log") as log:
                self.assertFalse(callback(PrivateKey()))
                log.assert_not_called()
        self.assertTrue(self.tracker.callback_failed)
        self.assertFalse(self.tracker.is_running)
        self.assertEqual(self.tracker.get_counts(), {"key_press_count": 1})
        self.assertNotIn("private", vars(self.tracker).values())

    def test_stop_does_not_join_the_listener_from_its_own_thread(self):
        self.tracker.start()
        listener = self.listeners[-1]
        with patch("agent.tracker.activity_tracker.current_thread", return_value=listener):
            self.tracker.stop()
        self.assertEqual(listener.join_calls, 0)

    def test_invalid_stop_timeout_is_rejected(self):
        for timeout in (-1, float("nan"), float("inf")):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                self.tracker.stop(timeout)


if __name__ == "__main__":
    unittest.main()
