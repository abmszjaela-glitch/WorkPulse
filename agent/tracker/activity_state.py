"""Shared activity timing for input trackers, without storing input details."""

from threading import Lock
from time import monotonic


class ActivityState:
    """Share one instance between trackers to maintain a common idle timer.

    Timestamps use monotonic seconds, so system clock changes cannot affect idle
    detection. Compare ``last_activity`` with ``time.monotonic()``, not wall time.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._last_activity = monotonic()

    @property
    def last_activity(self) -> float:
        """Return the latest activity timestamp under the shared lock."""
        with self._lock:
            return self._last_activity

    def touch(self) -> None:
        """Record activity without retaining any associated input data."""
        with self._lock:
            self._last_activity = monotonic()

    def inactivity_duration(self) -> float:
        """Read elapsed monotonic seconds atomically with respect to touch().

        Keep both clock sampling and timestamp access under the same lock, so
        an activity update cannot interleave with the duration calculation.
        """
        with self._lock:
            return max(0.0, monotonic() - self._last_activity)
