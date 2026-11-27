"""Exercise the default desktop → tray → agent wiring without real listeners."""
import unittest
from unittest.mock import Mock, patch

from agent.core.agent import ActivityAgent
from agent.ui.desktop import DesktopApplication


class DesktopControllerWiringTests(unittest.TestCase):
    def test_default_desktop_factory_constructs_agent_with_one_output_argument(self):
        with patch("agent.ui.tray.pystray.Icon"), patch.object(DesktopApplication, "_build_window"):
            desktop = DesktopApplication(Mock())
        tray = desktop.controller
        tray.authentication = Mock(tracking_identity=Mock(return_value="synthetic-employee"))
        tray.sender = Mock()
        tray.sender.can_record.return_value = True
        tray.sender.snapshot.return_value = {"policy_key": "synthetic-policy"}
        tray.sender.tracking_settings.return_value = {"idleThreshold": 300, "trackingInterval": 60}
        tray.policy = Mock(allows=Mock(return_value=True))

        # Intercept thread creation before any input listener can run. The real
        # factory and constructor must accept all kwargs from the tray unchanged.
        with patch("agent.ui.tray.Thread") as thread:
            try:
                tray._handle("start")
                self.assertIsInstance(tray._agent, ActivityAgent)
                self.assertEqual(thread.call_args.kwargs["target"], tray._agent.run)
                thread.return_value.start.assert_called_once()
                self.assertFalse(tray._agent.listeners_running)
                self.assertFalse(tray._agent.is_tracking)
                self.assertIsNotNone(tray._agent._on_interval)
                self.assertTrue(tray._agent._authorized())
            finally:
                tray._pause()


if __name__ == "__main__":
    unittest.main()
