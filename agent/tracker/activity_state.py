"""Shared activity timing for input trackers, without storing input details."""

from threading import Lock
from time import monotonic
from math import isfinite


class ActivityState:
    """Share one instance between trackers to maintain a common idle timer.

    Timestamps use monotonic seconds, so system clock changes cannot affect idle
    detection. Compare ``last_activity`` with ``time.monotonic()``, not wall time.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._last_activity = monotonic()
        self._active_threshold: float | None = None
        self._active_total = 0.0
        self._active_anchor = self._last_activity

    @property
    def last_activity(self) -> float:
        """Return the latest activity timestamp under the shared lock."""
        with self._lock:
            return self._last_activity

    def touch(self) -> None:
        """Record activity without retaining any associated input data."""
        with self._lock:
            now = monotonic()
            if self._active_threshold is not None:
                self._active_total += self._active_projection(now)
                self._active_anchor = now
            self._last_activity = now

    def inactivity_duration(self) -> float:
        """Read elapsed monotonic seconds atomically with respect to touch().

        Keep both clock sampling and timestamp access under the same lock, so
        an activity update cannot interleave with the duration calculation.
        """
        with self._lock:
            return max(0.0, monotonic() - self._last_activity)

    def _active_projection(self, now: float) -> float:
        """Called only under _lock, after the active clock is configured."""
        cutoff = min(now, self._last_activity + self._active_threshold)
        return max(0.0, cutoff - self._active_anchor)

    def active_elapsed(self, idle_threshold: float) -> float:
        """Return cumulative active seconds, without retaining input history.

        Input touches finalize each active segment up to its idle cutoff. This
        scalar clock therefore excludes idle gaps even if activity resumes before
        a usage summary is requested. Its threshold is fixed for this session.
        """
        if not isfinite(idle_threshold) or idle_threshold <= 0:
            raise ValueError("Idle threshold must be finite and positive.")
        with self._lock:
            now = monotonic()
            if self._active_threshold is None:
                self._active_threshold = idle_threshold
                self._active_anchor = now
            elif self._active_threshold != idle_threshold:
                raise ValueError("Restart tracking before changing the active-clock threshold.")
            return self._active_total + self._active_projection(now)
