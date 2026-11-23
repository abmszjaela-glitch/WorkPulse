"""On-demand idle detection using anonymous, shared activity timing."""

from .activity_state import ActivityState

# Support both `agent.tracker` imports and running from the agent directory.
# Configuration values and environment-variable parsing remain in config.py.
if __package__ == "tracker":
    from config import config
else:
    from ..config import config


class IdleDetector:
    """Classify the same ActivityState used by mouse and keyboard trackers.

    Set the IDLE_THRESHOLD environment variable (seconds) before starting the
    process to override the centralized default. No listener or background thread
    is created, and no individual input information is accessed or retained.
    """

    def __init__(self, activity_state: ActivityState, *, threshold=None) -> None:
        self.activity_state = activity_state
        if threshold is not None and (type(threshold) not in (int, float) or not 0 < threshold <= 86400):
            raise ValueError("Invalid idle threshold.")
        self._threshold = threshold

    @property
    def threshold(self):
        return config.IDLE_THRESHOLD if self._threshold is None else self._threshold

    def get_inactivity_duration(self) -> float:
        """Return elapsed seconds using the shared state's locked monotonic clock."""
        return self.activity_state.inactivity_duration()

    def get_status(self) -> str:
        """Return IDLE at or above IDLE_THRESHOLD, otherwise ACTIVE."""
        if self.get_inactivity_duration() >= self.threshold:
            return "IDLE"
        return "ACTIVE"

    def get_active_elapsed(self) -> float:
        """Monotonic active-time clock excluding gaps beyond IDLE_THRESHOLD."""
        return self.activity_state.active_elapsed(self.threshold)
