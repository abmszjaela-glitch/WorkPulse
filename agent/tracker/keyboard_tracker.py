"""Anonymous keyboard press counts; no keylogging or input-content collection."""

from __future__ import annotations

from pynput import keyboard

from .activity_state import ActivityState
from .activity_tracker import ActivityTracker


class KeyboardTracker(ActivityTracker):
    """Count press events and refresh a shared monotonic activity timestamp.

    No key names, characters, codes, text, per-key history or release events are
    recorded. OS auto-repeat press events count as additional presses. Pass the
    same ActivityState instance to mouse and keyboard trackers to share timing.
    Construction does not start a listener; call start() explicitly.
    """

    def __init__(self, activity_state: ActivityState | None = None) -> None:
        super().__init__(activity_state)
        self._key_press_count = 0
        self._callback_failed = False

    def _create_listener(self):
        with self._counter_lock:
            self._callback_failed = False
        # No on_release handler, key filter, hotkey mapping or event history.
        return keyboard.Listener(on_press=self._on_press)

    def _on_press(self, _key: object) -> bool | None:
        # pynput necessarily supplies a key object. Drop the reference before
        # doing anything else: never inspect, convert, retain or log its value.
        del _key
        try:
            with self._counter_lock:
                if not self._enabled:
                    return None
                self._key_press_count += 1
                self.activity_state.touch()
        except Exception:
            # Returning False stops pynput gracefully. Do not let an exception
            # reach its callback logger, or retain exception/event details.
            with self._counter_lock:
                self._enabled = False
                self._callback_failed = True
            return False
        return None

    def get_counts(self, *, reset: bool = False) -> dict[str, int]:
        """Return only the numeric count, optionally resetting it atomically."""
        with self._counter_lock:
            counts = {"key_press_count": self._key_press_count}
            if reset:
                self._key_press_count = 0
            return counts

    @property
    def key_press_count(self) -> int:
        """Total press events since construction or the last explicit reset."""
        return self.get_counts()["key_press_count"]

    @property
    def callback_failed(self) -> bool:
        """Report a callback failure without exposing input or exception data."""
        with self._counter_lock:
            return self._callback_failed
