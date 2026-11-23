"""Synthetic lifecycle tests; no real input listeners or browser launches."""
import unittest
from datetime import datetime, timedelta, timezone
from threading import Event
from unittest.mock import MagicMock, patch
from agent.auth.client import VerifiedSession
from agent.auth.session import AgentAuthentication
from agent.core.agent import ActivitySummary

from agent.ui.tray import TrayState, WorkPulseTray


class FakeAgent:
    def __init__(self):
        self.ready = Event()
        self.stopped = Event()
        self.is_tracking = False
        self.listeners_running = False
        self.summary = ActivitySummary("ACTIVE", 0, 0, 0, "synthetic.exe", {})
        self.durations = {"active_seconds": 0.0, "idle_seconds": 0.0}

    def get_summary(self):
        return self.summary

    def get_session_durations(self):
        return dict(self.durations)

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
        self.now = 1000
        self.client = MagicMock()
        self.client.login.return_value = VerifiedSession("synthetic-token", 2000, "employee-one", "employee@example.test", "E", False)
        self.auth = AgentAuthentication(self.tokens, client=self.client, clock=lambda: self.now)
        self.auth.perform(self.auth.begin("login", "employee@example.test", "synthetic-password"))
        self.tokens.reset_mock()
        self.sender = MagicMock()
        self.sender.can_record.side_effect = lambda owner: owner is not None
        self.sender.snapshot.return_value = {"ready": True, "consent_accepted": True, "policy_key": "synthetic"}
        self.sender.tracking_settings.return_value = {}
        self.sender.working_policy.return_value = None
        self.tray = WorkPulseTray(agent_factory=lambda **_: self.agent, token_store=self.tokens, authentication=self.auth, sender=self.sender, policy=self.policy, startup=self.startup)
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

    def test_signed_out_expired_and_temporary_sessions_cannot_create_listeners(self):
        factory = MagicMock()
        self.tray._factory = factory
        self.now = 2000
        self.tray._handle("start")
        factory.assert_not_called()
        self.auth.cancel()
        self.tray._handle("start")
        factory.assert_not_called()
        self.now = 1000
        self.client.login.return_value = VerifiedSession("temporary", 2000, "employee-one", "employee@example.test", "E", True)
        self.auth.perform(self.auth.begin("login", "employee@example.test", "synthetic-password"))
        self.tray._handle("start")
        factory.assert_not_called()
        self.assertFalse(self.tray._requested)

    def test_pause_resume_accumulates_each_run_once_without_counting_paused_time(self):
        agents = []
        def factory(**kwargs):
            self.assertTrue(kwargs["authorization"]())
            agent = FakeAgent()
            agents.append(agent)
            return agent
        self.tray._factory = factory
        self.tray._handle("start")
        self.assertTrue(agents[0].ready.wait(1))
        agents[0].summary = ActivitySummary("ACTIVE", 100, 10, 25, "first.exe", {"first.exe": 40})
        agents[0].durations = {"active_seconds": 50, "idle_seconds": 10}
        self.tray._cache_metrics()
        self.tray._cache_metrics()
        self.tray._handle("pause")
        self.tray._handle("pause")
        self.now = 1500  # Paused wall time must not enter any duration total.
        self.tray._handle("start")
        self.assertEqual(self.tray.desktop_snapshot()["mouse_movements"], 100)
        self.assertTrue(agents[1].ready.wait(1))
        agents[1].summary = ActivitySummary("IDLE", 20, 2, 5, "first.exe", {"first.exe": 10})
        agents[1].durations = {"active_seconds": 15, "idle_seconds": 5}
        for _ in range(3):
            self.tray._cache_metrics()
        view = self.tray.desktop_snapshot()
        self.assertEqual((view["mouse_movements"], view["mouse_clicks"], view["key_presses"]), (120, 12, 30))
        self.assertEqual((view["active_seconds"], view["idle_seconds"]), (65, 15))
        self.assertEqual(view["application_usage_seconds"], {"first.exe": 50})
        self.tray._handle("emergency")
        self.assertEqual(self.tray.desktop_snapshot()["mouse_movements"], 120)
        self.assertFalse(self.tray._requested)

    def test_logout_clears_totals_and_new_employee_cannot_inherit_them(self):
        self.tray._handle("start")
        self.assertTrue(self.agent.ready.wait(1))
        self.agent.summary = ActivitySummary("ACTIVE", 50, 5, 10)
        self.tray._handle("pause")
        self.assertEqual(self.tray.desktop_snapshot()["mouse_movements"], 50)
        self.tray._handle("logout")
        self.assertEqual(self.tray.desktop_snapshot()["mouse_movements"], 0)
        self.assertIsNone(self.tray._metrics_owner)
        self.client.login.return_value = VerifiedSession("second-token", 2000, "employee-two", "second@example.test", "E", False)
        self.tray._handle(self.auth.begin("login", "second@example.test", "synthetic-password"))
        self.assertEqual(self.tray.desktop_snapshot()["mouse_movements"], 0)
        self.assertEqual(self.tray._metrics_owner, "employee-two")

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

    def test_activation_flushes_the_running_interval_before_rotating_device_and_logout_cancels_it(self):
        from uuid import uuid4
        code = "wp1." + str(uuid4()) + "." + "x" * 43
        self.tray._handle("start")
        self.assertTrue(self.agent.ready.wait(1))
        self.sender.activate.side_effect = lambda _: self.assertFalse(self.agent.listeners_running)
        self.tray.activate_device(code)
        self.tray._handle(self.tray._commands.get_nowait())
        self.tray._handle(self.tray._commands.get_nowait())
        self.sender.activate.assert_called_once_with(code)
        self.sender.activate.reset_mock()
        self.tray.activate_device(code)
        self.auth.cancel()
        self.tray._handle(self.tray._commands.get_nowait())
        self.tray._handle(self.tray._commands.get_nowait())
        self.sender.activate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
