"""Central, privacy-restricted Python logging with bounded rotating files.

Call configure_logging() at visible application entry points. Library modules use
get_logger().info('event_code'), etc. Only fixed catalog events are accepted:
free-form messages, format arguments, exceptions/tracebacks and stack info are
dropped without rendering. Do not add employee-specific fields to this catalog.
This intentional allowlist is stronger than regex-based credential redaction.
"""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import sys
from threading import Lock
from time import monotonic

if __package__ == "utils":
    from config import config
else:
    from ..config import config


EVENTS = {
    "application_started": "Application started; tracking requires explicit employee action.",
    "application_stopped": "Application shutdown completed.",
    "application_error": "Application failed; review visible status and restart explicitly.",
    "logging_configured": "Operational logging configured.",
    "tracking_starting": "Tracking startup requested.",
    "tracking_on": "Tracking ON; listeners confirmed running.",
    "tracking_paused": "Tracking PAUSED.",
    "tracking_policy_paused": "Tracking PAUSED by working-hours policy.",
    "tracking_manual_stopped": "Tracking manually stopped; explicit restart required.",
    "tracking_stopped": "Tracking stopped; listener cleanup confirmed.",
    "tracking_error": "Tracking failed; listener shutdown requested.",
    "tracking_cleanup_error": "Listener shutdown could not be confirmed.",
    "ui_error": "A tracking control action failed; manual attention required.",
    "sync_succeeded": "Synchronization acknowledged by server.",
    "sync_offline": "Synchronization offline; pending records retained.",
    "sync_failed": "Synchronization failed; no success acknowledgement recorded.",
    "sync_auth_expired": "Synchronization requires renewed authentication.",
    "startup_enabled": "Current-user Windows startup registration enabled; launches paused.",
    "startup_removed": "Current-user Windows startup registration removed.",
    "startup_error": "Windows startup registration could not be changed or verified.",
    "local_logout": "Local logout completed; server revocation is unavailable.",
}
_THROTTLED = frozenset({"tracking_error", "ui_error", "sync_succeeded", "sync_offline", "sync_failed", "sync_auth_expired", "startup_error"})
_lock = Lock()
_warned = False
_configured = False


def _warn_once():
    global _warned
    if _warned:
        return
    _warned = True
    try:
        if sys.stderr is not None:
            sys.stderr.write("WorkPulse file logging is unavailable. Tracking controls remain available.\n")
    except Exception:
        pass


class _EventFilter(logging.Filter):
    def __init__(self):
        super().__init__()
        self._last = {}
        self._lock = Lock()

    def filter(self, record):
        if (not isinstance(record.msg, str) or record.msg not in EVENTS
                or record.args or record.exc_info or record.stack_info):
            return False
        event = record.msg
        if event in _THROTTLED:
            now = monotonic()
            with self._lock:
                if now - self._last.get(event, float("-inf")) < config.LOG_REPEAT_SECONDS:
                    return False
                self._last[event] = now
        # Formatter prints only timestamp, level and this fixed message. Discard
        # caller-provided extra fields; no repr/str conversion of caller objects.
        record.msg = EVENTS[event]
        record.args = ()
        record.exc_text = None
        return True


class _SafeRotatingHandler(RotatingFileHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.failed = False

    def emit(self, record):
        if self.failed:
            return
        try:
            super().emit(record)
        except Exception:
            self.handleError(record)

    def handleError(self, record):
        # Never call logging's default traceback/record dump on disk failures.
        self.failed = True
        _warn_once()


_logger = logging.getLogger("workpulse.agent")
_logger.propagate = False  # No root/third-party handlers receive our records.
_logger.addFilter(_EventFilter())
_logger.addHandler(logging.NullHandler())


def get_logger():
    """Return shared logging.Logger; this function never opens files."""
    return _logger


def configure_logging():
    """Idempotently enable safe file logging; return False on setup failure.

    No process-global root configuration/raiseExceptions changes are made. A
    runtime disk failure opens the handler's circuit until explicit shutdown and
    reconfiguration. Logging failures never disable employee tracking controls.
    """
    global _configured
    with _lock:
        if _configured:
            return not any(getattr(handler, "failed", False) for handler in _logger.handlers)
        handler = None
        try:
            directory = Path(config.LOG_DIRECTORY)
            directory.mkdir(parents=True, exist_ok=True)
            handler = _SafeRotatingHandler(directory / "workpulse.log", maxBytes=config.LOG_MAX_BYTES,
                                           backupCount=config.LOG_BACKUP_COUNT, encoding="utf-8")
            formatter = logging.Formatter("%(asctime)sZ %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%S")
            from time import gmtime
            formatter.converter = gmtime
            handler.setFormatter(formatter)
            _logger.addHandler(handler)
            _logger.setLevel(config.LOG_LEVEL)
            _configured = True
            _logger.debug("logging_configured")
            return True
        except Exception:
            if handler is not None:
                try:
                    _logger.removeHandler(handler)
                    handler.close()
                except Exception:
                    pass
            _warn_once()
            return False


def shutdown_logging():
    """Flush/close only WorkPulse's handlers, without global logging.shutdown()."""
    global _configured, _warned
    with _lock:
        for handler in tuple(_logger.handlers):
            if isinstance(handler, _SafeRotatingHandler):
                _logger.removeHandler(handler)
                try:
                    handler.close()
                except Exception:
                    _warn_once()
        _configured = False
        _warned = False
        for entry_filter in _logger.filters:
            if isinstance(entry_filter, _EventFilter):
                with entry_filter._lock:
                    entry_filter._last.clear()
