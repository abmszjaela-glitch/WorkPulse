"""Visible, foreground activity-counting agent.

Run from the repository root with ``python -m agent.core.agent``, or from the
agent directory with ``python -m core.agent``. Importing this module does not
start tracking. No networking, file persistence, services or autostart are used.
"""

from __future__ import annotations

import signal
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Event, Lock

if __package__ == "core":
    from config import config
    from tracker.activity_state import ActivityState
    from tracker.active_window_tracker import ActiveWindowTracker
    from tracker.app_usage_tracker import AppUsageTracker
    from tracker.activity_calculator import ActivityCalculator
    from tracker.idle_detector import IdleDetector
    from tracker.keyboard_tracker import KeyboardTracker
    from tracker.mouse_tracker import MouseTracker
else:
    from ..config import config
    from ..tracker.activity_state import ActivityState
    from ..tracker.active_window_tracker import ActiveWindowTracker
    from ..tracker.app_usage_tracker import AppUsageTracker
    from ..tracker.activity_calculator import ActivityCalculator
    from ..tracker.idle_detector import IdleDetector
    from ..tracker.keyboard_tracker import KeyboardTracker
    from ..tracker.mouse_tracker import MouseTracker


@dataclass(frozen=True)
class ActivitySummary:
    """Anonymous counts, activity status and the foreground process name only."""

    status: str
    mouse_movements: int
    mouse_clicks: int
    key_presses: int
    active_app: str | None = None
    app_usage: dict[str, float] = field(default_factory=dict)

    def format(self) -> str:
        usage = ", ".join(
            f"{name}: {seconds:.1f}s" for name, seconds in sorted(self.app_usage.items())
        ) or "None yet"
        return (
            f"Status={self.status} | Mouse movements={self.mouse_movements} | "
            f"Mouse clicks={self.mouse_clicks} | Key presses={self.key_presses} | "
            f"Active app={self.active_app or 'Unavailable'} | "
            f"App usage (active seconds)={usage}"
        )


def _console_output(message: str) -> None:
    """Flush status messages immediately so tracking is visibly disclosed."""
    print(message, flush=True)


class ActivityAgent:
    """Coordinate trackers in the calling thread, with interruptible reporting.

    ``run()`` blocks until ``stop()`` is requested, Ctrl+C is received, or a
    tracker fails. ``stop()`` can be called safely from another thread. An agent
    that has been stopped stays stopped; construct a new instance to run again.
    """

    def __init__(
        self,
        activity_state: ActivityState | None = None,
        *,
        output: Callable[[str], None] = _console_output,
    ) -> None:
        self.activity_state = (
            activity_state if activity_state is not None else ActivityState()
        )
        self.mouse_tracker = MouseTracker(self.activity_state)
        self.keyboard_tracker = KeyboardTracker(self.activity_state)
        self.idle_detector = IdleDetector(self.activity_state)
        self.active_window_tracker = ActiveWindowTracker()
        self.app_usage_tracker = AppUsageTracker(
            self.active_window_tracker, self.idle_detector
        )
        self.activity_calculator = ActivityCalculator(
            self.mouse_tracker, self.keyboard_tracker,
            self.idle_detector, self.app_usage_tracker,
        )
        self._trackers = (
            ("Mouse", self.mouse_tracker),
            ("Keyboard", self.keyboard_tracker),
            ("Application usage", self.app_usage_tracker),
            ("Foreground application", self.active_window_tracker),
        )
        self._output = output
        self._stop_event = Event()
        self._run_lock = Lock()

    def stop(self) -> None:
        """Request shutdown, immediately interrupting the reporting wait."""
        self._stop_event.set()

    def get_summary(self) -> ActivitySummary:
        """Read cumulative counters without resetting or recording event data."""
        mouse = self.mouse_tracker.get_counts()
        keyboard = self.keyboard_tracker.get_counts()
        return ActivitySummary(
            status=self.idle_detector.get_status(),
            mouse_movements=mouse["movement_count"],
            mouse_clicks=mouse["click_count"],
            key_presses=keyboard["key_press_count"],
            active_app=self.active_window_tracker.get_active_app(),
            app_usage=self.app_usage_tracker.get_usage_summary(cumulative=True),
        )

    def _check_listeners(self) -> None:
        if any(not tracker.is_running for _, tracker in self._trackers):
            raise RuntimeError("An activity listener is no longer running.")

    def _stop_listeners(self) -> list[str]:
        """Attempt every shutdown, even after a timeout or another interrupt."""
        failed = []
        for name, tracker in reversed(self._trackers):
            try:
                tracker.stop()
            except (Exception, KeyboardInterrupt):
                # Never print callback/backend exception details: they may
                # contain information outside the permitted aggregate summary.
                failed.append(name)
        return failed

    def _report_shutdown(
        self, *, started: bool, failed: bool, cleanup_failures: list[str]
    ) -> bool:
        """Report the outcome without failing cleanup on a closed output stream."""
        try:
            if failed:
                self._output("Tracking failed; shutdown was requested for all listeners.")
            if cleanup_failures:
                self._output(
                    "Listener shutdown could not be confirmed: "
                    + ", ".join(cleanup_failures)
                    + ". No further summaries will be collected."
                )
            elif started:
                self._output("Final cumulative summary: " + self.get_summary().format())
                self._output("Activity tracking STOPPED. All listeners stopped.")
            elif not failed:
                self._output("Activity tracking was cancelled before startup completed.")
        except (Exception, KeyboardInterrupt):
            return False
        return True

    def run(self) -> int:
        """Run visibly; return 0 on normal shutdown, 1 on tracking/cleanup failure."""
        if not self._run_lock.acquire(blocking=False):
            raise RuntimeError("This activity agent is already running.")

        started = False
        failed = False
        cleanup_failures = []
        final_interval = None
        try:
            if not self._stop_event.is_set():
                self._output(
                    "WorkPulse foreground activity tracking is starting. "
                    "Mouse movement, mouse click and key press counts, plus the current "
                    "foreground process name, are collected. No window titles, documents, "
                    "URLs, coordinates, key contents, typed text or screenshots are stored. "
                    "Data stays in memory; nothing is uploaded. Press Ctrl+C to stop."
                )
                self._output(
                    "Application duration totals exclude idle time. Activity scores "
                    "measure input intensity only, not productivity or employee performance."
                )
                for _, tracker in self._trackers:
                    if self._stop_event.is_set():
                        break
                    tracker.start()

                if not self._stop_event.is_set():
                    self._check_listeners()
                    self.activity_state.touch()
                    self.activity_calculator.start()
                    started = True
                    self._output(
                        "Activity tracking RUNNING. "
                        f"Cumulative summaries every {config.TRACKING_INTERVAL} seconds; "
                        f"idle threshold {config.IDLE_THRESHOLD} seconds; "
                        f"foreground app polling every {config.ACTIVE_WINDOW_INTERVAL} seconds."
                    )
                    self._output(self.get_summary().format())
                    # Event.wait() allows immediate shutdown instead of waiting
                    # out a blocking sleep. Foreground app sampling has its own
                    # explicitly started, low-frequency poller.
                    while not self._stop_event.wait(config.TRACKING_INTERVAL):
                        self._check_listeners()
                        self._output(self.get_summary().format())
                        interval_summary = self.activity_calculator.calculate_summary()
                        if interval_summary is not None:
                            self._output(json.dumps(interval_summary, allow_nan=False))
        except KeyboardInterrupt:
            self.stop()
        except Exception:
            failed = True
        finally:
            self.stop()
            try:
                cleanup_failures = self._stop_listeners()
                try:
                    final_interval = self.activity_calculator.stop()
                except Exception:
                    failed = True
            finally:
                self._run_lock.release()

        if final_interval is not None:
            try:
                self._output(json.dumps(final_interval, allow_nan=False))
            except (Exception, KeyboardInterrupt):
                failed = True
        reported = self._report_shutdown(
            started=started, failed=failed, cleanup_failures=cleanup_failures
        )
        return int(failed or bool(cleanup_failures) or not reported)


def main() -> int:
    """CLI entry point: request orderly cleanup on console interrupt or SIGTERM."""
    agent = ActivityAgent()
    previous_handlers = {}

    def request_stop(_signum, _frame) -> None:
        agent.stop()

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[signum] = signal.signal(signum, request_stop)
        return agent.run()
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(main())
