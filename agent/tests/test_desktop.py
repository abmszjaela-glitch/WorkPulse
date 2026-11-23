"""Native widgets with a fake controller: no actual input listeners or backend."""
from pathlib import Path
import tempfile
import gc
from threading import Event
import tkinter as tk
import unittest
from unittest.mock import Mock, patch

from agent.core.agent import ActivityAgent
from agent.ui.desktop import DesktopApplication, duration_text
from agent.utils import logger


class FakeController:
    def __init__(self):
        self.policy = Mock(describe=Mock(return_value="Test working-hours policy"))
        self.commands = []
        self._agent = None
        self._requested = False
        self.stop = Event()
        self.view = dict(tracking="Tracking PAUSED", sync="Unavailable", last_sync="Never", startup="Not registered", closed=False, tray_visible=True, policy_open=True,
                         mouse_movements=12, mouse_clicks=3, key_presses=7, active_app="synthetic.exe", active_seconds=65, idle_seconds=5,
                         auth={"state": "signed_in", "signed_in": True, "user_id": "synthetic-employee"})

    def desktop_snapshot(self):
        return dict(self.view)

    def request(self, command):
        self.commands.append(command)
        if command == "exit":
            self.view["closed"] = True
            self.stop.set()

    def run(self):
        self.stop.wait(5)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.controller = FakeController()
        self.app = DesktopApplication(self.root, controller=self.controller)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.app.dispose()
        try:
            self.root.destroy()
        except tk.TclError:
            pass
        self.app = self.root = None
        gc.collect()

    def test_initialization_never_starts_tracking(self):
        self.assertEqual(self.controller.commands, [])
        self.assertEqual(self.app.status_var.get(), "Tracking PAUSED")
        self.assertEqual(self.root.title(), "WorkPulse Agent 1.0.0")

    def test_cached_metrics_and_timing_are_displayed(self):
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(self.app.values["mouse_movements"].get(), "12")
        self.assertEqual(self.app.values["active_seconds"].get(), "00:01:05")
        self.assertEqual(self.app.values["active_app"].get(), "synthetic.exe")
        self.assertIn("Never", self.app.last_sync_var.get())

    def test_explicit_consent_is_required_and_manual_controls_are_forwarded(self):
        with patch("agent.ui.desktop.messagebox.askyesno", return_value=False):
            self.app.start_tracking()
        self.assertEqual(self.controller.commands, [])
        with patch("agent.ui.desktop.messagebox.askyesno", return_value=True):
            self.app.start_tracking()
        self.app.pause()
        self.app.emergency_stop()
        self.assertEqual(self.controller.commands, ["start", "pause", "emergency"])

    def test_unsigned_user_cannot_start_even_when_confirmation_would_allow_it(self):
        self.controller.view["auth"] = {"state": "signed_out", "signed_in": False}
        with patch("agent.ui.desktop.messagebox.askyesno", return_value=True) as confirm:
            self.app.start_tracking()
        confirm.assert_not_called()
        self.assertEqual(self.controller.commands, [])
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(str(self.app.start_button.cget("state")), "disabled")

    def test_policy_and_logging_errors_disable_resume(self):
        self.controller.view["policy_open"] = False
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(str(self.app.start_button.cget("state")), "disabled")
        with patch("agent.ui.desktop.logging_available", return_value=False):
            self.app._poll()
        self.assertIn("emergency", self.controller.commands)

    def test_callback_errors_log_only_fixed_event_and_stop(self):
        with tempfile.TemporaryDirectory(prefix=".desktop-test-", dir=Path(__file__).parent) as directory:
            logger.shutdown_logging()
            with patch.object(logger.config, "LOG_DIRECTORY", Path(directory)):
                self.app._callback_error(RuntimeError, RuntimeError("fabricated-private-content"), None)
                logger.shutdown_logging()
            content = (Path(directory) / "workpulse.log").read_text()
            self.assertIn("Desktop callback failed", content)
            self.assertNotIn("fabricated-private-content", content)
        self.assertIn("emergency", self.controller.commands)

    def test_close_requests_exit_without_hiding_window_to_tray(self):
        self.app.close()
        self.assertEqual(self.controller.commands, ["exit"])
        self.assertTrue(self.app._closing)

    def test_session_timing_freezes_after_stop(self):
        agent = ActivityAgent(policy=Mock())
        agent._session_started = 0
        with patch("agent.core.agent.monotonic", return_value=10), patch.object(agent.idle_detector, "get_active_elapsed", return_value=6):
            agent.stop()
        with patch("agent.core.agent.monotonic", return_value=100):
            self.assertEqual(agent.get_session_durations(), {"active_seconds": 6, "idle_seconds": 4})
        self.assertEqual(duration_text(3661), "01:01:01")


if __name__ == "__main__":
    unittest.main()
