"""Deterministic scheduling tests using UTC instants and synthetic input only."""
from datetime import datetime, time, timezone
import unittest
from unittest.mock import Mock, patch

from agent.core.working_hours import WorkingHoursPolicy
from agent.core.agent import ActivityAgent
from agent.tracker.activity_state import ActivityState
from agent.tracker.keyboard_tracker import KeyboardTracker
from agent.tracker.mouse_tracker import MouseTracker
from agent.tracker.active_window_tracker import ActiveWindowTracker


def instant(value):
    return datetime.fromisoformat(value)


class WorkingHoursTests(unittest.TestCase):
    def test_boundaries_and_weekends(self):
        policy = WorkingHoursPolicy(zone="Asia/Colombo", start=time(9), end=time(17, 30), days={0, 1, 2, 3, 4})
        for value, expected in (
            ("2026-11-19T08:59:59+05:30", False),
            ("2026-11-19T09:00:00+05:30", True),
            ("2026-11-19T17:29:59+05:30", True),
            ("2026-11-19T17:30:00+05:30", False),
            ("2026-11-21T12:00:00+05:30", False),
        ):
            with self.subTest(value=value):
                self.assertEqual(policy.allows(instant(value)), expected)

    def test_overnight_shift_belongs_to_start_day(self):
        policy = WorkingHoursPolicy(zone="UTC", start=time(22), end=time(6), days={4})
        self.assertTrue(policy.allows(instant("2026-11-21T05:59:59+00:00")))
        self.assertFalse(policy.allows(instant("2026-11-21T06:00:00+00:00")))
        self.assertFalse(policy.allows(instant("2026-11-21T22:00:00+00:00")))

    def test_dst_spring_gap_and_repeated_autumn_hour(self):
        policy = WorkingHoursPolicy(zone="America/New_York", start=time(1), end=time(3), days={6})
        # Spring jumps from 01:59 to 03:00: no fabricated 02:xx instant.
        self.assertTrue(policy.allows(instant("2026-03-08T06:59:59+00:00")))
        self.assertFalse(policy.allows(instant("2026-03-08T07:00:00+00:00")))
        # Both real occurrences of 01:30 in fall follow wall-clock hours.
        self.assertTrue(policy.allows(instant("2026-11-01T05:30:00+00:00")))
        self.assertTrue(policy.allows(instant("2026-11-01T06:30:00+00:00")))
        self.assertFalse(policy.allows(instant("2026-11-01T08:00:00+00:00")))

    def test_instant_conversion_and_explicit_policy_timezone_change(self):
        now = instant("2026-11-19T05:00:00+00:00")
        colombo = WorkingHoursPolicy(zone="Asia/Colombo", start=time(9), end=time(17), days={3})
        utc = WorkingHoursPolicy(zone="UTC", start=time(9), end=time(17), days={3})
        self.assertTrue(colombo.allows(now))
        self.assertEqual(colombo.allows(now), colombo.allows(now.astimezone(timezone.utc)))
        self.assertFalse(utc.allows(now))
        with self.assertRaises(ValueError):
            colombo.allows(datetime(2026, 11, 19, 10))

    def test_denied_input_does_not_count_or_touch_activity_timestamp(self):
        state = ActivityState()
        state.recording_allowed = lambda: False
        mouse, keyboard = MouseTracker(state), KeyboardTracker(state)
        mouse._enabled = keyboard._enabled = True
        before = state.last_activity
        mouse._on_move(0, 0)
        mouse._on_click(0, 0, object(), True)
        keyboard._on_press(object())
        self.assertEqual(mouse.get_counts(), {"movement_count": 0, "click_count": 0})
        self.assertEqual(keyboard.key_press_count, 0)
        self.assertEqual(state.last_activity, before)

    def test_console_agent_outside_hours_never_starts_listeners(self):
        messages = []
        agent = ActivityAgent(policy=Mock(allows=Mock(return_value=False), describe=Mock(return_value="closed")), output=messages.append, authorization=lambda: True)
        with patch.object(agent.mouse_tracker, "start") as mouse, patch.object(agent.keyboard_tracker, "start") as keyboard:
            self.assertEqual(agent.run(), 0)
        mouse.assert_not_called()
        keyboard.assert_not_called()
        self.assertEqual(agent.pause_reason, "working_hours")
        self.assertTrue(any("Tracking PAUSED" in text for text in messages))

    def test_closed_policy_skips_foreground_process_query(self):
        tracker = ActiveWindowTracker()
        tracker.recording_allowed = lambda: False
        with patch.object(tracker, "_detect_application") as query:
            tracker._poll()
        query.assert_not_called()
        self.assertIsNone(tracker.get_active_app())


if __name__ == "__main__":
    unittest.main()
