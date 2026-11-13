"""Idle detection tests use controlled clocks and synthetic input listeners."""

import os
import runpy
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from agent.tracker.activity_state import ActivityState
from agent.tracker.idle_detector import IdleDetector
from agent.tracker.keyboard_tracker import KeyboardTracker
from agent.tracker.mouse_tracker import MouseTracker
from test_mouse_tracker import FakeListener


class IdleDetectorTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        clock = patch(
            "agent.tracker.activity_state.monotonic", side_effect=lambda: self.now
        )
        clock.start()
        self.addCleanup(clock.stop)
        threshold = patch("agent.tracker.idle_detector.config.IDLE_THRESHOLD", 300)
        threshold.start()
        self.addCleanup(threshold.stop)
        self.activity = ActivityState()
        self.detector = IdleDetector(self.activity)

    def test_fresh_activity_is_active_with_zero_inactivity(self):
        self.assertEqual(self.detector.get_status(), "ACTIVE")
        self.assertEqual(self.detector.get_inactivity_duration(), 0.0)

    def test_threshold_boundary(self):
        for elapsed, expected in (
            (299.999, "ACTIVE"), (300.0, "IDLE"), (300.001, "IDLE")
        ):
            with self.subTest(elapsed=elapsed):
                self.now = 1000.0 + elapsed
                self.assertEqual(self.detector.get_status(), expected)

    def test_duration_and_wall_clock_independence(self):
        self.now += 42.5
        with patch("time.time", side_effect=AssertionError("No wall clock usage")):
            self.assertEqual(self.detector.get_inactivity_duration(), 42.5)
            self.assertEqual(self.detector.get_status(), "ACTIVE")

    def test_mouse_movement_click_and_key_press_reset_the_shared_timer(self):
        with patch("agent.tracker.mouse_tracker.mouse.Listener", FakeListener):
            mouse = MouseTracker(self.activity)
            mouse.start()
        self.addCleanup(mouse.stop)
        with patch("agent.tracker.keyboard_tracker.keyboard.Listener", FakeListener):
            keyboard = KeyboardTracker(self.activity)
            keyboard.start()
        self.addCleanup(keyboard.stop)
        events = [
            lambda: mouse._listener.callbacks["on_move"](1, 2),
            lambda: mouse._listener.callbacks["on_click"](1, 2, object(), True),
            lambda: keyboard._listener.callbacks["on_press"](object()),
        ]
        for event in events:
            self.now += 300
            self.assertEqual(self.detector.get_status(), "IDLE")
            event()
            self.assertEqual(self.detector.get_status(), "ACTIVE")
            self.assertEqual(self.detector.get_inactivity_duration(), 0.0)

    def test_reads_centralized_threshold(self):
        self.now += 10
        with patch("agent.tracker.idle_detector.config.IDLE_THRESHOLD", 10):
            self.assertEqual(self.detector.get_status(), "IDLE")
        with patch("agent.tracker.idle_detector.config.IDLE_THRESHOLD", 11):
            self.assertEqual(self.detector.get_status(), "ACTIVE")

    def test_threshold_can_be_loaded_from_the_environment(self):
        config_path = Path(__file__).resolve().parents[1] / "config" / "config.py"
        with patch.dict(os.environ, {"IDLE_THRESHOLD": "17"}, clear=True):
            settings = runpy.run_path(str(config_path))
        self.assertEqual(settings["IDLE_THRESHOLD"], 17)
        self.now += 17
        with patch(
            "agent.tracker.idle_detector.config.IDLE_THRESHOLD",
            settings["IDLE_THRESHOLD"],
        ):
            self.assertEqual(self.detector.get_status(), "IDLE")

    def test_concurrent_touches_and_checks_are_safe(self):
        def check_batch(_):
            for _ in range(200):
                self.activity.touch()
                self.assertGreaterEqual(self.detector.get_inactivity_duration(), 0.0)
                self.assertEqual(self.detector.get_status(), "ACTIVE")

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(check_batch, range(8)))

    def test_status_queries_do_not_modify_activity(self):
        timestamp = self.activity.last_activity
        self.now += 400
        for _ in range(3):
            self.assertEqual(self.detector.get_status(), "IDLE")
        self.assertEqual(self.activity.last_activity, timestamp)


if __name__ == "__main__":
    unittest.main()
