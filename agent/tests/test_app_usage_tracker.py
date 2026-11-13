"""Controlled-clock usage tests; no Windows queries or real input capture."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from agent.tracker.activity_state import ActivityState
from agent.tracker.active_window_tracker import ActiveWindowTracker
from agent.tracker.app_usage_tracker import AppUsageTracker
from agent.tracker.idle_detector import IdleDetector


class AppUsageTrackerTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        for target in (
            "agent.tracker.activity_state.monotonic",
            "agent.tracker.active_window_tracker.monotonic",
        ):
            clock = patch(target, side_effect=lambda: self.now)
            clock.start()
            self.addCleanup(clock.stop)
        threshold = patch("agent.tracker.idle_detector.config.IDLE_THRESHOLD", 10)
        threshold.start()
        self.addCleanup(threshold.stop)
        self.state = ActivityState()
        self.idle = IdleDetector(self.state)
        self.foreground = ActiveWindowTracker()
        detection = patch.object(self.foreground, "_detect_application", return_value="editor.exe")
        self.detect = detection.start()
        self.addCleanup(detection.stop)
        self.addCleanup(self.foreground.stop)
        self.usage = AppUsageTracker(self.foreground, self.idle)
        self.addCleanup(self.usage.stop)
        self.foreground._poll()
        self.usage.start()

    def switch(self, name, when):
        self.now = when
        self.detect.return_value = name
        self.foreground._poll()

    def test_running_usage_and_repeated_reads_never_double_count(self):
        self.now = 5
        for _ in range(3):
            self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 5.0})
        self.now = 8
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 8.0})

    def test_switch_finalizes_previous_app_and_return_accumulates(self):
        self.switch("browser.exe", 4)
        self.now = 7
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 4.0, "browser.exe": 3.0})
        self.switch("EDITOR.EXE", 8)
        self.now = 9
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 5.0, "browser.exe": 4.0})

    def test_partial_interval_crossing_idle_cutoff_is_clamped_exactly(self):
        self.now = 7
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 7.0})
        self.now = 15
        self.assertEqual(self.idle.get_status(), "IDLE")
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 10.0})
        self.now = 100
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 10.0})

    def test_idle_gap_is_excluded_even_if_resumed_between_summaries(self):
        self.now = 20
        self.state.touch()
        self.now = 22
        self.state.touch()
        self.now = 25
        self.assertEqual(self.idle.get_status(), "ACTIVE")
        # Active 0..10 and 20..25, excluding the entire idle gap 10..20.
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 15.0})

    def test_switch_while_idle_does_not_attribute_idle_time_to_either_app(self):
        self.switch("browser.exe", 15)
        self.now = 20
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 10.0})
        self.state.touch()
        self.now = 23
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 10.0, "browser.exe": 3.0})

    def test_unavailable_application_gap_is_not_attributed(self):
        self.switch(None, 4)
        self.now = 7
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 4.0})
        self.switch("browser.exe", 8)
        self.now = 9
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 4.0, "browser.exe": 1.0})

    def test_reset_returns_interval_and_preserves_cumulative_totals(self):
        self.now = 3
        self.assertEqual(self.usage.reset_interval(), {"editor.exe": 3.0})
        self.assertEqual(self.usage.get_usage_summary(), {})
        self.now = 5
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 2.0})
        self.assertEqual(self.usage.get_usage_summary(cumulative=True), {"editor.exe": 5.0})
        self.assertEqual(self.usage.reset_interval(), {"editor.exe": 2.0})
        self.assertEqual(self.usage.reset_interval(), {})
        self.now = 7
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 2.0})
        self.assertEqual(self.usage.get_usage_summary(cumulative=True), {"editor.exe": 7.0})

    def test_stop_finalizes_and_restart_does_not_count_stopped_gap(self):
        self.now = 3
        self.usage.stop()
        self.usage.stop()
        self.assertFalse(self.usage.is_running)
        self.assertEqual(len(self.foreground._observers), 0)
        self.switch("browser.exe", 6)
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 3.0})
        self.now = 7
        self.usage.start()
        self.usage.start()
        self.assertEqual(len(self.foreground._observers), 1)
        self.now = 9
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 3.0, "browser.exe": 2.0})

    def test_foreground_stop_finalizes_and_clears_attribution(self):
        self.now = 4
        self.foreground.stop()
        self.now = 8
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 4.0})

    def test_concurrent_resets_drain_time_only_once(self):
        self.now = 5
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.usage.reset_interval(), range(80)))
        self.assertEqual(sum(sum(result.values()) for result in results), 5.0)
        self.assertEqual(self.usage.get_usage_summary(cumulative=True), {"editor.exe": 5.0})

    def test_summary_is_an_isolated_name_to_duration_mapping(self):
        self.now = 5
        summary = self.usage.get_usage_summary()
        summary["editor.exe"] = 999
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 5.0})
        self.assertTrue(all(isinstance(name, str) and isinstance(seconds, float)
                            for name, seconds in self.usage.get_usage_summary().items()))

    def test_no_wall_clock_and_no_additional_worker(self):
        self.now = 5
        with patch("time.time", side_effect=AssertionError("No wall clock")):
            self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 5.0})
        self.assertFalse(self.foreground.is_running)
        self.assertFalse(hasattr(self.usage, "_thread"))

    def test_active_clock_accounts_multiple_idle_resume_cycles_without_history(self):
        for instant in (20, 40, 45):
            self.now = instant
            self.state.touch()
        self.now = 47
        # 0..10, 20..30, 40..47 are active.
        self.assertEqual(self.usage.get_usage_summary(), {"editor.exe": 27.0})

    def test_changed_threshold_requires_a_new_session(self):
        with patch("agent.tracker.idle_detector.config.IDLE_THRESHOLD", 20):
            with self.assertRaises(ValueError):
                self.usage.get_usage_summary()

    def test_subscription_failure_does_not_leave_usage_enabled(self):
        tracker = AppUsageTracker(self.foreground, self.idle)
        with patch.object(self.foreground, "observe", side_effect=RuntimeError("Failed")):
            with self.assertRaises(RuntimeError):
                tracker.start()
        self.assertFalse(tracker.is_running)
        tracker.stop()


if __name__ == "__main__":
    unittest.main()
