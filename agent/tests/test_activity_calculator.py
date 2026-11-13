"""Interval scoring tests use aggregate fake counters and controlled clocks."""

import json
import os
import runpy
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from agent.tracker.activity_calculator import ActivityCalculator
from agent.tracker.activity_state import ActivityState
from agent.tracker.idle_detector import IdleDetector


class FakeCounter:
    def __init__(self, activity_state, **counts):
        self.activity_state = activity_state
        self.counts = counts
        self.resets = 0

    def get_counts(self, *, reset=False):
        result = dict(self.counts)
        if reset:
            self.resets += 1
            self.counts = {name: 0 for name in self.counts}
        return result


class FakeUsage:
    def __init__(self):
        self.totals = {}

    def get_usage_summary(self, *, cumulative=False):
        if not cumulative:
            raise AssertionError("Calculator must not consume another interval ledger")
        return dict(self.totals)


class ActivityCalculatorTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        for target in (
            "agent.tracker.activity_calculator.monotonic",
            "agent.tracker.activity_state.monotonic",
        ):
            clock = patch(target, side_effect=lambda: self.now)
            clock.start()
            self.addCleanup(clock.stop)
        self.state = ActivityState()
        self.mouse = FakeCounter(self.state, movement_count=0, click_count=0)
        self.keyboard = FakeCounter(self.state, key_press_count=0)
        self.idle = IdleDetector(self.state)
        self.usage = FakeUsage()
        self.calculator = ActivityCalculator(
            self.mouse, self.keyboard, self.idle, self.usage, interval=60
        )
        self.calculator.start()

    def test_normal_interval_counts_durations_score_and_json(self):
        self.mouse.counts.update(movement_count=60, click_count=15)
        self.keyboard.counts["key_press_count"] = 60
        self.usage.totals["editor.exe"] = 40.0
        self.now = 60
        summary = self.calculator.calculate_summary()
        self.assertEqual(summary["counts"], {"mouse_movements": 60, "mouse_clicks": 15, "key_presses": 60})
        self.assertEqual(summary["active_seconds"], 60.0)
        self.assertEqual(summary["idle_seconds"], 0.0)
        self.assertEqual(summary["activity_score"], 50.0)
        self.assertFalse(summary["score_is_productivity_or_performance"])
        self.assertEqual(json.loads(json.dumps(summary)), summary)

    def test_empty_interval_is_zero_score_but_respects_idle_grace_period(self):
        self.now = 60
        summary = self.calculator.calculate_summary()
        self.assertEqual(summary["activity_score"], 0)
        self.assertEqual(sum(summary["counts"].values()), 0)
        self.assertEqual(summary["active_seconds"] + summary["idle_seconds"], 60)

    def test_completely_idle_interval(self):
        self.calculator.stop()
        self.now = 400
        self.calculator.start()
        self.now = 460
        summary = self.calculator.calculate_summary()
        self.assertEqual(summary["status"], "IDLE")
        self.assertEqual(summary["active_seconds"], 0)
        self.assertEqual(summary["idle_seconds"], 60)
        self.assertEqual(summary["activity_score"], 0)

    def test_interval_crossing_idle_threshold(self):
        self.now = 360
        summary = self.calculator.calculate_summary()
        self.assertEqual(summary["active_seconds"], 300)
        self.assertEqual(summary["idle_seconds"], 60)
        self.assertEqual(summary["interval_seconds"], 360)

    def test_idle_resume_between_summary_calls_is_excluded(self):
        self.now = 330
        self.state.touch()
        self.now = 335
        self.state.touch()
        self.keyboard.counts["key_press_count"] = 2
        self.now = 360
        summary = self.calculator.calculate_summary()
        self.assertEqual(summary["active_seconds"], 330)
        self.assertEqual(summary["idle_seconds"], 30)
        self.assertEqual(summary["status"], "ACTIVE")

    def test_not_due_does_not_consume_counts(self):
        self.mouse.counts["movement_count"] = 10
        self.now = 59
        self.assertIsNone(self.calculator.calculate_summary())
        self.now = 60
        self.assertEqual(self.calculator.calculate_summary()["counts"]["mouse_movements"], 10)

    def test_success_resets_interval_view_without_erasing_raw_totals(self):
        self.keyboard.counts["key_press_count"] = 20
        self.now = 60
        self.assertEqual(self.calculator.calculate_summary()["counts"]["key_presses"], 20)
        self.now = 120
        self.assertEqual(self.calculator.calculate_summary()["counts"]["key_presses"], 0)
        self.assertEqual(self.keyboard.counts["key_press_count"], 20)
        self.assertEqual(self.mouse.resets + self.keyboard.resets, 0)

    def test_application_interval_deltas_preserve_cumulative_usage(self):
        self.usage.totals["editor.exe"] = 10.0
        self.now = 60
        first = self.calculator.calculate_summary()
        self.usage.totals["editor.exe"] = 25.0
        self.now = 120
        second = self.calculator.calculate_summary()
        self.assertEqual(first["application_usage_seconds"], {"editor.exe": 10.0})
        self.assertEqual(second["application_usage_seconds"], {"editor.exe": 15.0})
        self.assertEqual(second["cumulative_application_usage_seconds"], {"editor.exe": 25.0})
        self.assertEqual(self.usage.totals, {"editor.exe": 25.0})

    def test_failed_summary_does_not_reset_interval(self):
        self.keyboard.counts["key_press_count"] = 10
        self.now = 60
        with patch.object(self.calculator, "_score", return_value=float("nan")):
            with self.assertRaises(ValueError):
                self.calculator.calculate_summary()
        summary = self.calculator.calculate_summary()
        self.assertEqual(summary["counts"]["key_presses"], 10)
        self.assertEqual(summary["interval_seconds"], 60)

    def test_zero_duration_forced_summary_does_not_divide_by_zero(self):
        summary = self.calculator.calculate_summary(force=True)
        self.assertEqual(summary["interval_seconds"], 0)
        self.assertEqual(summary["activity_score"], 0)
        self.assertEqual(summary["active_seconds"], 0)
        self.assertEqual(summary["idle_seconds"], 0)

    def test_custom_weights_and_saturation(self):
        calculator = ActivityCalculator(self.mouse, self.keyboard, self.idle, interval=10,
            weights={"mouse_movements": 0, "mouse_clicks": 0, "key_presses": 1})
        calculator.start()
        self.keyboard.counts["key_press_count"] = 2000
        self.now = 10
        summary = calculator.calculate_summary()
        self.assertEqual(summary["activity_score"], 100)
        self.assertEqual(summary["configured_interval_seconds"], 10)

    def test_concurrent_calls_commit_only_one_due_interval(self):
        self.keyboard.counts["key_press_count"] = 10
        self.now = 60
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.calculator.calculate_summary(), range(16)))
        summaries = [result for result in results if result is not None]
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["counts"]["key_presses"], 10)

    def test_external_counter_reset_is_reported_without_committing(self):
        self.keyboard.counts["key_press_count"] = 20
        self.now = 60
        self.calculator.calculate_summary()
        self.keyboard.counts["key_press_count"] = 0
        self.now = 120
        with self.assertRaises(RuntimeError):
            self.calculator.calculate_summary()

    def test_invalid_policies_and_intervals(self):
        for interval in (0, -1, float("nan"), float("inf")):
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                ActivityCalculator(self.mouse, self.keyboard, self.idle, interval=interval)
        for weights in ({}, {"mouse_movements": 0, "mouse_clicks": 0, "key_presses": 0}):
            with self.subTest(weights=weights), self.assertRaises(ValueError):
                ActivityCalculator(self.mouse, self.keyboard, self.idle, weights=weights)

    def test_stop_flushes_partial_interval_and_is_idempotent(self):
        self.now = 12
        self.keyboard.counts["key_press_count"] = 3
        summary = self.calculator.stop()
        self.assertEqual(summary["interval_seconds"], 12)
        self.assertEqual(summary["counts"]["key_presses"], 3)
        self.assertIsNone(self.calculator.stop())
        self.assertFalse(self.calculator.is_running)

    def test_score_settings_are_environment_configurable(self):
        path = Path(__file__).resolve().parents[1] / "config" / "config.py"
        with patch.dict(os.environ, {"TRACKING_INTERVAL": "15", "ACTIVITY_KEY_WEIGHT": "2.5", "ACTIVITY_KEYS_PER_MINUTE": "90"}, clear=True):
            settings = runpy.run_path(str(path))
        self.assertEqual(settings["TRACKING_INTERVAL"], 15)
        self.assertEqual(settings["ACTIVITY_SCORE_WEIGHTS"]["key_presses"], 2.5)
        self.assertEqual(settings["ACTIVITY_REFERENCE_COUNTS_PER_MINUTE"]["key_presses"], 90)


if __name__ == "__main__":
    unittest.main()
