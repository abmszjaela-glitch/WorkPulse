"""Idle-aware application duration totals; no window or input content is stored."""

from __future__ import annotations

from threading import Lock

from .active_window_tracker import ActiveApplication, ActiveWindowTracker
from .idle_detector import IdleDetector


class AppUsageTracker:
    """Account usage at observed foreground transitions without another thread.

    IdleDetector supplies a time.monotonic()-based active-time clock which pauses
    during idle gaps. Only numeric totals keyed by process name are retained.
    Foreground transitions and summary/reset operations are serialized by the
    foreground tracker's snapshot lock. Unobserved switches between polls cannot
    be reconstructed; no history of individual input events is kept.
    """

    def __init__(
        self, active_window_tracker: ActiveWindowTracker, idle_detector: IdleDetector
    ) -> None:
        self._foreground = active_window_tracker
        self._idle = idle_detector
        self._lock = Lock()
        self._lifecycle_lock = Lock()
        self._running = False
        self._unsubscribe = None
        self._current_app: str | None = None
        self._last_active_elapsed = 0.0
        self._interval: dict[str, float] = {}
        self._totals: dict[str, float] = {}

    def _update_locked(self, snapshot: ActiveApplication | None) -> None:
        if not self._running:
            return
        active_elapsed = self._idle.get_active_elapsed()
        duration = max(0.0, active_elapsed - self._last_active_elapsed)
        if self._current_app is not None and duration > 0:
            for ledger in (self._interval, self._totals):
                ledger[self._current_app] = ledger.get(self._current_app, 0.0) + duration
        self._last_active_elapsed = active_elapsed
        # Windows process names are case-insensitive; merge differently cased
        # observations of the same app instead of creating duplicate totals.
        self._current_app = snapshot.name.casefold() if snapshot is not None else None

    def _on_foreground(self, snapshot: ActiveApplication | None) -> None:
        with self._lock:
            self._update_locked(snapshot)

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def start(self) -> None:
        """Subscribe without starting another poller or taking over dependencies."""
        with self._lifecycle_lock:
            if self._unsubscribe is not None:
                return
            with self._lock:
                self._last_active_elapsed = self._idle.get_active_elapsed()
                self._current_app = None
                self._running = True
            try:
                self._unsubscribe = self._foreground.observe(self._on_foreground)
            except Exception:
                with self._lock:
                    self._running = False
                raise

    def get_usage_summary(self, *, cumulative: bool = False) -> dict[str, float]:
        """Return an isolated app-name -> seconds snapshot, including live usage.

        The default covers the current reporting interval. ``cumulative=True``
        returns totals across every interval since this tracker was constructed.
        Reading advances the accounting cursor, so repeated reads never recount
        elapsed time. Neither view stores timestamps or input details in its output.
        """
        def read(snapshot):
            with self._lock:
                self._update_locked(snapshot)
                return dict(self._totals if cumulative else self._interval)

        return self._foreground.read_with_snapshot(read)

    def reset_interval(self) -> dict[str, float]:
        """Atomically return completed interval totals and start a fresh interval.

        Lifetime cumulative totals are preserved. The ongoing foreground app and
        accounting cursor are retained, so its time is split exactly at the reset.
        """
        def reset(snapshot):
            with self._lock:
                self._update_locked(snapshot)
                completed = dict(self._interval)
                self._interval.clear()
                return completed

        return self._foreground.read_with_snapshot(reset)

    def stop(self) -> None:
        """Finalize current usage and unsubscribe; leave dependency lifecycle alone."""
        with self._lifecycle_lock:
            if self._unsubscribe is None:
                return

            def finish(snapshot):
                with self._lock:
                    self._update_locked(snapshot)
                    self._running = False
                    self._current_app = None

            self._foreground.read_with_snapshot(finish)
            self._unsubscribe()
            self._unsubscribe = None
