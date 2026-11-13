"""Foreground tracking tests mock all OS/process queries; no real apps are read."""

import io
import os
import runpy
import unittest
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import FrozenInstanceError
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

import psutil
import pywintypes

from agent.tracker.active_window_tracker import ActiveApplication, ActiveWindowTracker


class ActiveWindowTrackerTests(unittest.TestCase):
    def setUp(self):
        self.process = Mock()
        self.process.name.return_value = "editor.exe"
        patches = {
            "window": patch(
                "agent.tracker.active_window_tracker.win32gui.GetForegroundWindow",
                return_value=100,
            ),
            "pid": patch(
                "agent.tracker.active_window_tracker.win32process.GetWindowThreadProcessId",
                return_value=(1, 42),
            ),
            "process": patch(
                "agent.tracker.active_window_tracker.psutil.Process",
                return_value=self.process,
            ),
            "title": patch(
                "agent.tracker.active_window_tracker.win32gui.GetWindowText",
                side_effect=AssertionError("Window titles must never be read"),
            ),
        }
        self.queries = {}
        for name, query_patch in patches.items():
            self.queries[name] = query_patch.start()
            self.addCleanup(query_patch.stop)
        self.tracker = ActiveWindowTracker(interval=60)
        self.addCleanup(self.tracker.stop)

    def test_foreground_handle_resolves_pid_and_only_process_name(self):
        with patch("agent.tracker.active_window_tracker.monotonic", return_value=1000):
            self.tracker._poll()
        self.queries["pid"].assert_called_once_with(100)
        self.queries["process"].assert_called_once_with(42)
        self.assertEqual(self.process.method_calls, [("name", (), {})])
        self.queries["title"].assert_not_called()
        self.assertEqual(self.tracker.get_active_app(), "editor.exe")
        self.assertEqual(self.tracker.get_snapshot(), ActiveApplication("editor.exe", 1000))
        self.assertEqual(set(vars(self.tracker.get_snapshot())), {"name", "started_at"})

    def test_same_app_preserves_timestamp_and_changed_app_resets_it(self):
        self.process.name.side_effect = ["editor.exe", "EDITOR.EXE", "browser.exe"]
        with patch("agent.tracker.active_window_tracker.monotonic", side_effect=[10, 20]):
            self.tracker._poll()
            self.tracker._poll()
            self.assertEqual(self.tracker.started_at, 10)
            self.tracker._poll()
        self.assertEqual(self.tracker.get_active_app(), "browser.exe")
        self.assertEqual(self.tracker.started_at, 20)

    def test_no_foreground_window_or_pid_is_unavailable(self):
        self.queries["window"].return_value = 0
        self.tracker._poll()
        self.assertIsNone(self.tracker.get_active_app())
        self.queries["pid"].assert_not_called()
        self.queries["window"].return_value = 100
        self.queries["pid"].return_value = (1, 0)
        self.tracker._poll()
        self.queries["process"].assert_not_called()

    def test_inaccessible_or_terminated_process_clears_previous_app(self):
        for error in (psutil.AccessDenied(42), psutil.NoSuchProcess(42), psutil.ZombieProcess(42)):
            with self.subTest(error=type(error).__name__):
                self.tracker._poll()
                self.assertIsNotNone(self.tracker.get_active_app())
                with patch.object(self.process, "name", side_effect=error):
                    self.tracker._poll()
                self.assertIsNone(self.tracker.get_snapshot())

    def test_disappearing_window_is_safe(self):
        self.queries["pid"].side_effect = pywintypes.error(1400, "lookup", "private")
        self.tracker._poll()
        self.assertIsNone(self.tracker.get_active_app())
        self.assertFalse(self.tracker.has_failed)

    def test_focus_change_during_lookup_discards_stale_result(self):
        self.queries["window"].side_effect = [100, 200]
        self.tracker._poll()
        self.assertIsNone(self.tracker.get_active_app())

    def test_start_stop_restart_and_interruptible_interval(self):
        ready = Event()
        original_poll = self.tracker._poll

        def poll():
            original_poll()
            ready.set()

        with patch.object(self.tracker, "_poll", side_effect=poll) as polling:
            self.tracker.stop()
            self.tracker.start()
            self.assertTrue(ready.wait(2))
            first_thread = self.tracker._thread
            self.tracker.start()
            self.assertIs(self.tracker._thread, first_thread)
            self.assertTrue(self.tracker.is_running)
            self.assertEqual(polling.call_count, 1)
            self.tracker.stop(timeout=2)
            self.assertFalse(first_thread.is_alive())
            self.assertIsNone(self.tracker.get_active_app())
            self.tracker.stop()
            ready.clear()
            self.tracker.start()
            self.assertTrue(ready.wait(2))
            self.assertIsNot(self.tracker._thread, first_thread)

    def test_late_lookup_after_stop_is_discarded_and_timeout_can_be_retried(self):
        entered, release = Event(), Event()

        def lookup():
            entered.set()
            release.wait(2)
            return "late.exe"

        with patch.object(self.tracker, "_detect_application", side_effect=lookup):
            self.tracker.start()
            try:
                self.assertTrue(entered.wait(2))
                with self.assertRaises(TimeoutError):
                    self.tracker.stop(timeout=0)
                self.assertIsNone(self.tracker.get_active_app())
                with self.assertRaises(RuntimeError):
                    self.tracker.start()
            finally:
                release.set()
                self.tracker.stop(timeout=2)
        self.assertIsNone(self.tracker.get_snapshot())

    def test_unexpected_worker_error_is_not_logged_or_retained(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with patch("logging.Logger._log") as log:
                with patch.object(self.tracker, "_poll", side_effect=RuntimeError("private")):
                    self.tracker.start()
                    self.tracker._thread.join(2)
                log.assert_not_called()
        self.assertTrue(self.tracker.has_failed)
        self.assertFalse(self.tracker.is_running)
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
        self.assertNotIn("private", vars(self.tracker).values())

    def test_snapshot_is_immutable_and_empty_when_stopped(self):
        self.assertIsNone(self.tracker.get_snapshot())
        self.tracker._poll()
        snapshot = self.tracker.get_snapshot()
        with self.assertRaises(FrozenInstanceError):
            snapshot.name = "other.exe"
        self.tracker.stop()
        self.assertIsNone(self.tracker.get_snapshot())

    def test_configurable_interval_and_invalid_values(self):
        with patch("agent.tracker.active_window_tracker.config.ACTIVE_WINDOW_INTERVAL", 13):
            tracker = ActiveWindowTracker()
            self.assertEqual(tracker._interval, 13)
        for interval in (0, -1, float("inf"), float("nan")):
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                ActiveWindowTracker(interval=interval)
        for timeout in (-1, float("inf"), float("nan")):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                self.tracker.stop(timeout=timeout)

    def test_polling_interval_is_environment_configurable(self):
        config_path = Path(__file__).resolve().parents[1] / "config" / "config.py"
        with patch.dict(os.environ, {"ACTIVE_WINDOW_INTERVAL": "4"}, clear=True):
            settings = runpy.run_path(str(config_path))
        self.assertEqual(settings["ACTIVE_WINDOW_INTERVAL"], 4)

    def test_observer_failure_does_not_block_other_consumers_or_shutdown(self):
        observations = []

        def failed_observer(snapshot):
            if snapshot is not None:
                raise RuntimeError("private")

        remove_failed = self.tracker.observe(failed_observer)
        remove_good = self.tracker.observe(observations.append)
        self.tracker._poll()
        self.assertTrue(self.tracker.has_failed)
        self.assertEqual(observations[-1].name, "editor.exe")
        self.tracker.stop()
        self.assertIsNone(observations[-1])
        remove_failed()
        remove_good()
        self.assertEqual(len(self.tracker._observers), 0)


if __name__ == "__main__":
    unittest.main()
