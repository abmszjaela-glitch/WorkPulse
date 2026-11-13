"""Count mouse activity using pynput without retaining input details."""

from __future__ import annotations

from pynput import mouse

from .activity_state import ActivityState
from .activity_tracker import ActivityTracker


class MouseTracker(ActivityTracker):
    """Own a stoppable listener and thread-safe aggregate activity counters.

    Pass the same ``ActivityState`` to other trackers to share ``last_activity``.
    Movement counts represent events, not distance. Each button press counts as
    one click; button releases refresh activity without counting another click.
    No listener is started until ``start()`` is called.
    """

    def __init__(self, activity_state: ActivityState | None = None) -> None:
        super().__init__(activity_state)
        self._movement_count = 0
        self._click_count = 0

    def _create_listener(self):
        return mouse.Listener(on_move=self._on_move, on_click=self._on_click)

    def _record_activity(self, *, movement: bool = False, click: bool = False) -> None:
        """Keep callbacks short; counts and activity change together."""
        with self._counter_lock:
            if not self._enabled:
                return
            self._movement_count += int(movement)
            self._click_count += int(click)
            self.activity_state.touch()

    def _on_move(self, _x: int, _y: int) -> None:
        # pynput supplies coordinates, but they are never retained or logged.
        self._record_activity(movement=True)

    def _on_click(self, _x: int, _y: int, _button: object, pressed: bool) -> None:
        # Discard coordinates and button identity; count only button-down events.
        self._record_activity(click=pressed)

    def get_counts(self, *, reset: bool = False) -> dict[str, int]:
        """Return an atomic snapshot; optionally reset both counters atomically."""
        with self._counter_lock:
            counts = {
                "movement_count": self._movement_count,
                "click_count": self._click_count,
            }
            if reset:
                self._movement_count = 0
                self._click_count = 0
            return counts

    @property
    def movement_count(self) -> int:
        return self.get_counts()["movement_count"]

    @property
    def click_count(self) -> int:
        return self.get_counts()["click_count"]

