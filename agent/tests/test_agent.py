"""Exercise orchestration with fake listeners; never capture real input."""

import signal
import unittest
from threading import Event, Thread
from unittest.mock import Mock, patch

from agent.core.agent import ActivityAgent, ActivitySummary, main
from test_mouse_tracker import FakeListener


class ActivityAgentTests(unittest.TestCase):
    def setUp(self):
        for target in (
            "agent.tracker.mouse_tracker.mouse.Listener",
            "agent.tracker.keyboard_tracker.keyboard.Listener",
        ):
            listener_patch = patch(target, FakeListener)
            listener_patch.start()
            self.addCleanup(listener_patch.stop)
        self.messages = []
        self.agent = ActivityAgent(output=self.messages.append)
        self.addCleanup(self.agent.mouse_tracker.stop)
        self.addCleanup(self.agent.keyboard_tracker.stop)

    def test_all_modules_share_one_activity_state(self):
        for component in (
            self.agent.mouse_tracker,
            self.agent.keyboard_tracker,
            self.agent.idle_detector,
        ):
            self.assertIs(component.activity_state, self.agent.activity_state)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_periodic_counts_status_and_visible_shutdown(self):
        def wait(_interval):
            if self.agent._stop_event.is_set():
                return True
            mouse = self.agent.mouse_tracker._listener.callbacks
            mouse["on_move"](1, 2)
            mouse["on_click"](1, 2, object(), True)
            mouse["on_click"](1, 2, object(), False)
            self.agent.keyboard_tracker._listener.callbacks["on_press"](object())
            self.agent.stop()
            return False

        with patch("agent.core.agent.config.TRACKING_INTERVAL", 7):
            with patch.object(self.agent._stop_event, "wait", side_effect=wait) as waiting:
                self.assertEqual(self.agent.run(), 0)
                waiting.assert_any_call(7)
        text = "\n".join(self.messages)
        self.assertIn("Activity tracking RUNNING", text)
        self.assertIn("Press Ctrl+C to stop", text)
        self.assertIn("Status=ACTIVE | Mouse movements=1 | Mouse clicks=1 | Key presses=1", text)
        self.assertIn("Activity tracking STOPPED", text)
        self.assertEqual(self.agent.get_summary().key_presses, 1)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_idle_status_is_reported(self):
        with patch.object(self.agent._stop_event, "wait", side_effect=[False, True]):
            with patch.object(self.agent.idle_detector, "get_status", return_value="IDLE"):
                self.assertEqual(self.agent.run(), 0)
        self.assertTrue(any("Status=IDLE" in message for message in self.messages))

    def test_stop_before_run_prevents_listener_start(self):
        self.agent.stop()
        with patch.object(self.agent.mouse_tracker, "start") as start:
            self.assertEqual(self.agent.run(), 0)
        start.assert_not_called()
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_ctrl_c_stops_both_listeners(self):
        with patch.object(self.agent._stop_event, "wait", side_effect=KeyboardInterrupt):
            self.assertEqual(self.agent.run(), 0)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_stop_interrupts_a_real_wait_without_waiting_for_the_interval(self):
        ready = Event()
        results = []

        def output(message):
            if "Activity tracking RUNNING" in message:
                ready.set()

        self.agent._output = output
        worker = Thread(target=lambda: results.append(self.agent.run()))
        try:
            worker.start()
            self.assertTrue(ready.wait(timeout=2))
            self.agent.stop()
        finally:
            self.agent.stop()
            worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(results, [0])
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_partial_startup_failure_cleans_up_without_printing_error_details(self):
        with patch.object(
            self.agent.keyboard_tracker, "start", side_effect=RuntimeError("private")
        ):
            self.assertEqual(self.agent.run(), 1)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertNotIn("private", "\n".join(self.messages))
        self.assertFalse(any("tracking RUNNING" in message for message in self.messages))

    def test_failure_stopping_one_tracker_still_stops_the_other(self):
        with patch.object(self.agent._stop_event, "wait", return_value=True):
            with patch.object(
                self.agent.keyboard_tracker, "stop", side_effect=TimeoutError("private")
            ):
                self.assertEqual(self.agent.run(), 1)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertNotIn("private", "\n".join(self.messages))
        self.assertTrue(any("Keyboard" in message for message in self.messages))
        self.assertFalse(any("All listeners stopped" in message for message in self.messages))

    def test_output_failure_does_not_leave_listeners_running(self):
        self.agent._output = Mock(side_effect=[None, RuntimeError("Output failed"), None, None])
        self.assertEqual(self.agent.run(), 1)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_closed_console_does_not_raise_during_shutdown(self):
        self.agent._output = Mock(side_effect=BrokenPipeError)
        self.assertEqual(self.agent.run(), 1)
        self.assertFalse(self.agent.mouse_tracker.is_running)
        self.assertFalse(self.agent.keyboard_tracker.is_running)

    def test_listener_failure_during_run_requests_cleanup(self):
        def listener_failure(_interval):
            self.agent.keyboard_tracker._listener.alive = False
            return False

        with patch.object(self.agent._stop_event, "wait", side_effect=listener_failure):
            self.assertEqual(self.agent.run(), 1)
        self.assertFalse(self.agent.mouse_tracker.is_running)

    def test_second_concurrent_run_is_rejected(self):
        self.agent._run_lock.acquire()
        try:
            with self.assertRaisesRegex(RuntimeError, "already running"):
                self.agent.run()
        finally:
            self.agent._run_lock.release()

    def test_summary_contains_only_status_and_numeric_counts(self):
        summary = self.agent.get_summary()
        self.assertEqual(summary, ActivitySummary("ACTIVE", 0, 0, 0))
        self.assertEqual(set(vars(summary)), {"status", "mouse_movements", "mouse_clicks", "key_presses"})

    def test_cli_installs_stop_signals_and_restores_handlers(self):
        fake_agent = Mock()
        fake_agent.run.return_value = 0
        handlers = {}

        def install(signum, handler):
            handlers[signum] = handler
            return signal.SIG_DFL

        def run():
            handlers[signal.SIGTERM](signal.SIGTERM, None)
            return 0

        fake_agent.run.side_effect = run
        with patch("agent.core.agent.ActivityAgent", return_value=fake_agent):
            with patch("agent.core.agent.signal.signal", side_effect=install) as signals:
                self.assertEqual(main(), 0)
        fake_agent.stop.assert_called_once()
        self.assertEqual(signals.call_count, 4)
        self.assertIs(handlers[signal.SIGINT], signal.SIG_DFL)
        self.assertIs(handlers[signal.SIGTERM], signal.SIG_DFL)


if __name__ == "__main__":
    unittest.main()
