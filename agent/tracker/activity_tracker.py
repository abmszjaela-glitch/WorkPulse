"""Shared, bounded listener lifecycle for aggregate input trackers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from math import isfinite
from threading import Lock, current_thread

from .activity_state import ActivityState


class ActivityTracker(ABC):
    """Serialize start/stop operations without blocking input counter updates."""

    def __init__(self, activity_state: ActivityState | None = None) -> None:
        self.activity_state = (
            activity_state if activity_state is not None else ActivityState()
        )
        self._counter_lock = Lock()
        self._lifecycle_lock = Lock()
        self._enabled = False
        self._listener = None

    @abstractmethod
    def _create_listener(self):
        """Create a new listener; a stopped pynput listener cannot be reused."""
        raise NotImplementedError

    @property
    def last_activity(self) -> float:
        return self.activity_state.last_activity

    @property
    def is_running(self) -> bool:
        with self._lifecycle_lock:
            with self._counter_lock:
                return bool(
                    self._enabled
                    and self._listener is not None
                    and self._listener.is_alive()
                )

    def start(self) -> None:
        """Start once, or create a fresh listener after a completed stop.

        pynput thread objects cannot be restarted. Counters persist across starts
        until explicitly reset through ``get_counts(reset=True)``.
        """
        with self._lifecycle_lock:
            if self._listener is not None:
                if self._listener.is_alive():
                    with self._counter_lock:
                        if self._enabled:
                            return
                    raise RuntimeError("The previous activity listener is still stopping.")
                previous = self._listener
                self._listener = None
                # Surface callback/backend errors from a listener that has exited.
                previous.join(timeout=0)

            listener = self._create_listener()
            self._listener = listener
            with self._counter_lock:
                self._enabled = True
            try:
                listener.start()
            except Exception:
                with self._counter_lock:
                    self._enabled = False
                # Retain the reference if shutdown is still pending, so callers
                # can retry stop() rather than losing a potentially running thread.
                listener.stop()
                if not listener.is_alive():
                    self._listener = None
                raise

    def stop(self, timeout: float = 5.0) -> None:
        """Stop recording immediately, then wait at most ``timeout`` seconds.

        Safe before start and on repeated calls. Never join the listener from its
        own thread. A timeout raises ``TimeoutError`` and retains the listener for
        another stop attempt; callback errors are propagated by pynput's join().
        """
        if timeout < 0 or not isfinite(timeout):
            raise ValueError("timeout must be finite and non-negative.")

        with self._lifecycle_lock:
            listener = self._listener
            if listener is None:
                return
            with self._counter_lock:
                self._enabled = False
            try:
                listener.stop()
                if listener is current_thread():
                    return
                listener.join(timeout=timeout)
                if listener.is_alive():
                    raise TimeoutError("Activity listener did not stop before the timeout.")
            finally:
                if not listener.is_alive():
                    self._listener = None
