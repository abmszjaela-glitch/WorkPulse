"""Windows foreground process-name detection, without collecting window content."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable
from math import isfinite
from threading import Event, Lock, RLock, Thread, current_thread
from time import monotonic

import psutil
import pywintypes
import win32gui
import win32process

if __package__ == "tracker":
    from config import config
else:
    from ..config import config


@dataclass(frozen=True)
class ActiveApplication:
    """Only the process name and when it was first observed, in monotonic seconds."""

    name: str
    started_at: float


class ActiveWindowTracker:
    """Sample app changes at a bounded rate while explicitly started.

    Only the current application is retained; no usage history, process IDs,
    window handles, titles, documents, URLs or input contents are recorded.
    Changes between polls may be missed. ``started_at`` is the observation time,
    not the process creation time. App changes do not reset the input idle timer.
    """

    def __init__(self, interval: float | None = None) -> None:
        self._interval = float(
            config.ACTIVE_WINDOW_INTERVAL if interval is None else interval
        )
        if not isfinite(self._interval) or self._interval <= 0:
            raise ValueError("Foreground polling interval must be finite and positive.")
        self._state_lock = RLock()
        self._lifecycle_lock = Lock()
        self._stop_event = Event()
        self._thread: Thread | None = None
        self._active: ActiveApplication | None = None
        self._failed = False
        self._observers: set[Callable[[ActiveApplication | None], None]] = set()

    def _set_active(self, snapshot: ActiveApplication | None) -> None:
        """Publish observations under _state_lock; callbacks receive no OS data."""
        if snapshot == self._active:
            return
        self._active = snapshot
        for observer in tuple(self._observers):
            try:
                observer(snapshot)
            except Exception:
                # One failed consumer must not prevent other consumers from
                # finalizing their totals or prevent stop() from joining safely.
                self._failed = True
                self._stop_event.set()

    def observe(
        self, observer: Callable[[ActiveApplication | None], None]
    ) -> Callable[[], None]:
        """Subscribe to changes and receive the current snapshot atomically.

        Observers must be short and must not start/stop this tracker. Updates and
        read_with_snapshot() share a lock to prevent overlapping usage accounting.
        Call the returned function to unsubscribe.
        """
        with self._state_lock:
            self._observers.add(observer)
            try:
                observer(self._active)
            except Exception:
                self._observers.discard(observer)
                raise

        def unsubscribe() -> None:
            with self._state_lock:
                self._observers.discard(observer)

        return unsubscribe

    def read_with_snapshot(self, reader: Callable):
        """Serialize a short snapshot consumer with foreground change callbacks."""
        with self._state_lock:
            return reader(self._active)

    @staticmethod
    def _detect_application() -> str | None:
        """Resolve a foreground handle to a process name; never read its title."""
        try:
            handle = win32gui.GetForegroundWindow()
            if not handle:
                return None
            _, process_id = win32process.GetWindowThreadProcessId(handle)
            if process_id <= 0:
                return None
            name = psutil.Process(process_id).name()
            # If focus changed during lookup, defer identification to the next
            # poll instead of attributing the old application to the new window.
            if win32gui.GetForegroundWindow() != handle:
                return None
            return name if isinstance(name, str) and name else None
        except (psutil.Error, pywintypes.error, OSError):
            # Access denial, process exit and disappearing windows are expected.
            # Do not log exceptions or retain process/window details.
            return None

    def _poll(self) -> None:
        name = self._detect_application()
        with self._state_lock:
            if self._stop_event.is_set():
                return
            if name is None:
                self._set_active(None)
            elif self._active is None or self._active.name.casefold() != name.casefold():
                self._set_active(ActiveApplication(name=name, started_at=monotonic()))

    def _run(self) -> None:
        try:
            while not self._stop_event.is_set():
                self._poll()
                if self._stop_event.wait(self._interval):
                    break
        except Exception:
            # Expose a failure flag, never raw exception or process details.
            with self._state_lock:
                self._failed = True
        finally:
            self._stop_event.set()
            with self._state_lock:
                try:
                    self._set_active(None)
                except Exception:
                    self._failed = True

    def get_snapshot(self) -> ActiveApplication | None:
        """Return an immutable, atomic snapshot, or None when unavailable/stopped."""
        with self._state_lock:
            return self._active

    def get_active_app(self) -> str | None:
        """Return only the current process name, such as 'chrome.exe'."""
        snapshot = self.get_snapshot()
        return snapshot.name if snapshot is not None else None

    @property
    def started_at(self) -> float | None:
        snapshot = self.get_snapshot()
        return snapshot.started_at if snapshot is not None else None

    @property
    def is_running(self) -> bool:
        with self._lifecycle_lock:
            return bool(
                self._thread is not None
                and self._thread.is_alive()
                and not self._stop_event.is_set()
            )

    @property
    def has_failed(self) -> bool:
        with self._state_lock:
            return self._failed

    def start(self) -> None:
        """Start one poller, or create a fresh thread after a completed stop."""
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                if self._stop_event.is_set():
                    raise RuntimeError("The previous foreground poller is still stopping.")
                return
            self._stop_event.clear()
            with self._state_lock:
                self._set_active(None)
                self._failed = False
            self._thread = Thread(
                target=self._run, name="WorkPulse-ForegroundApps", daemon=True
            )
            try:
                self._thread.start()
            except Exception:
                self._stop_event.set()
                self._thread = None
                raise

    def stop(self, timeout: float = 5.0) -> None:
        """Wake the poller immediately and join it safely within a bounded time.

        If an OS lookup does not finish in time, raise TimeoutError and retain
        the thread for a later stop attempt. Late lookup results are discarded.
        """
        if not isfinite(timeout) or timeout < 0:
            raise ValueError("timeout must be finite and non-negative.")
        with self._lifecycle_lock:
            self._stop_event.set()
            with self._state_lock:
                self._set_active(None)
            thread = self._thread
            if thread is None or thread is current_thread():
                return
            thread.join(timeout=timeout)
            if thread.is_alive():
                raise TimeoutError("Foreground poller did not stop before the timeout.")
            self._thread = None
