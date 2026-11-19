"""Synthetic lifecycle tests; no real input listeners or browser launches."""
import unittest
from datetime import datetime, timedelta, timezone
from threading import Event
from unittest.mock import MagicMock, patch

from agent.ui.tray import TrayState, WorkPulseTray


class FakeAgent:
    def __init__(self):
        self.ready = Event()
        self.stopped = Event()
        self.is_tracking = False
        self.listeners_running = False

    def run(self):
        self.is_tracking = self.listeners_running = True
        self.ready.set()
        self.stopped.wait(3)
        self.is_tracking = self.listeners_running = False

    def stop(self):
        self.stopped.set()


class TrayTests(unittest.TestCase):
    def setUp(self):
        icon = patch("agent.ui.tray.pystray.Icon")
        self.icon = icon.start().return_value
        self.addCleanup(icon.stop)
        self.agent = FakeAgent()
        self.tokens = MagicMock()
        self.policy = MagicMock()
        self.policy.allows.return_value = True
        self.startup = MagicMock()
        self.startup.status.return_value = "Not registered"
        self.tray = WorkPulseTray(agent_factory=lambda **_: self.agent, token_store=self.tokens, policy=self.policy, startup=self.startup)
        self.addCleanup(self.tray._pause)

    def test_startup_is_opt_in_and_does_not_authorize_tracking(self):
        self.startup.enable.assert_not_called()
        self.tray._handle("startup_status")
        self.startup.enable.assert_not_called()
        self.tray._handle("startup_enable")
        self.startup.enable.assert_called_once()
        self.assertTrue(self.tray._manual_stop.is_set())
        self.assertFalse(self.tray._requested)
        self.assertIsNone(self.tray._agent)
        self.tray._handle("startup_remove")
        self.startup.remove.assert_called_once()

    def test_startup_error_does_not_stop_or_enable_tracking(self):
        from agent.core.windows_startup import StartupError
        self.startup.enable.side_effect = StartupError("Windows denied the startup change.")
        self.tray._handle("startup_enable")
        self.assertEqual(self.tray.state.snapshot()[0], "Tracking PAUSED")
        self.assertFalse(self.tray._requested)
        self.assertIn("Unable to verify", self.tray._startup_status)

    def test_starts_paused_and_only_reports_confirmed_activity(self):
        self.assertEqual(self.tray.state.snapshot()[0], "Tracking PAUSED")
        self.assertFalse(self.agent.ready.is_set())
        self.tray._handle("start")
        self.assertTrue(self.agent.ready.wait(1))
        self.tray._refresh()
        self.assertEqual(self.tray.state.snapshot()[0], "Tracking ON")
        self.tray._handle("pause")
        self.assertFalse(self.agent.listeners_running)
        self.assertEqual(self.tray.state.snapshot()[0], "Tracking PAUSED")

    def test_logout_stops_before_clearing_token(self):
        self.tray._handle("start")
        self.assertTrue(self.agent.ready.wait(1))
        self.tokens.clear.side_effect = lambda: self.assertFalse(self.agent.listeners_running)
        self.tray._handle("logout")
        self.tokens.clear.assert_called_once()

    def test_dashboard_uses_explicit_configured_url(self):
        with patch("agent.ui.tray.config.DASHBOARD_URL", "https://dashboard.invalid"), patch("agent.ui.tray.webbrowser.open") as browser:
            self.tray._handle("dashboard")
            browser.assert_called_once_with("https://dashboard.invalid")

    def test_failed_listener_shutdown_does_not_claim_paused(self):
        self.tray._agent = MagicMock(listeners_running=True)
        self.tray._runner = MagicMock()
        with self.assertRaises(RuntimeError):
            self.tray._pause()
        self.assertNotEqual(self.tray.state.snapshot()[0], "Tracking PAUSED")
        self.tray._agent = self.tray._runner = None

    def test_closed_hours_reject_start_without_arming_restart(self):
        self.policy.allows.return_value = False
        self.tray._handle("start")
        self.assertIsNone(self.tray._agent)
        self.assertFalse(self.tray._requested)
        self.policy.allows.return_value = True
        self.tray._schedule()
        self.assertIsNone(self.tray._agent)

    def test_scheduled_pause_can_resume_but_manual_stop_cannot(self):
        agents = []
        def factory(**_):
            agent = FakeAgent()
            agents.append(agent)
            return agent
        self.tray._factory = factory
        self.tray._handle("start")
        self.assertTrue(agents[0].ready.wait(1))
        self.policy.allows.return_value = False
        self.tray._schedule()
        self.assertFalse(agents[0].listeners_running)
        self.assertIn("outside working hours", self.tray.state.snapshot()[0])
        self.policy.allows.return_value = True
        self.tray._schedule()
        self.assertEqual(len(agents), 2)
        self.assertTrue(agents[1].ready.wait(1))
        self.tray._handle("emergency")
        self.policy.allows.return_value = False
        self.tray._schedule()
        self.policy.allows.return_value = True
        self.tray._schedule()
        self.assertEqual(len(agents), 2)
        self.assertIn("explicit restart", self.tray.state.snapshot()[0])
        self.tray._handle("start")
        self.assertEqual(len(agents), 3)

    def test_emergency_vetoes_queued_start(self):
        self.tray.request("start")
        self.tray.request("emergency")
        self.tray._handle(self.tray._commands.get_nowait())
        self.assertIsNone(self.tray._agent)
        self.tray._handle(self.tray._commands.get_nowait())
        self.tray._schedule()
        self.assertIsNone(self.tray._agent)

    def test_sync_requires_real_acknowledgement_to_show_success_time(self):
        state = TrayState()
        self.assertEqual(state.snapshot()[2], "Never")
        state.update_sync(offline=True)
        self.assertIn("Offline", state.snapshot()[1])
        self.assertEqual(state.snapshot()[2], "Never")
        state.update_sync(acknowledged_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        last = state.snapshot()[2]
        self.assertNotEqual(last, "Never")
        state.update_sync(offline=True)
        self.assertEqual(state.snapshot()[2], last)
        with self.assertRaises(ValueError):
            state.update_sync(acknowledged_at=datetime.now())


if __name__ == "__main__":
    unittest.main()
