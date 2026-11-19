"""Early Python-level error boundary, before tracking configuration/UI imports.

Recovery logging deliberately has a small independent 64 KiB/one-backup budget:
the normal configuration may be the reason startup failed. Never formats an
exception, traceback, environment value, credentials or personal data.
"""
import ctypes
from datetime import datetime, timezone
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import sys
import threading


def record_failure(event="application_error"):
    try:
        from agent.utils.logger import configure_logging, get_logger, logging_available
        if configure_logging():
            get_logger().error(event)
            if logging_available():
                return True
    except Exception:
        pass
    try:
        base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("USERPROFILE") or str(Path(__file__).resolve().parent)) / "WorkPulse" / "logs"
        directory = Path(os.environ.get("LOG_DIRECTORY", str(base)))
        directory.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(directory / "startup-error.log", maxBytes=65536, backupCount=1, encoding="utf-8")
        try:
            stamp = datetime.now(timezone.utc).isoformat()
            # Only this fixed message, never an incoming exception/event string.
            message = stamp + " ERROR WorkPulse could not initialize or continue safely; tracking stop requested."
            record = logging.LogRecord("workpulse.recovery", logging.ERROR, "", 0, message, (), None)
            if handler.shouldRollover(record):
                handler.doRollover()
            handler.stream.write(message + "\n")
            handler.stream.flush()
        finally:
            handler.close()
        return True
    except Exception:
        return False


def show_startup_error():
    try:
        ctypes.windll.user32.MessageBoxW(None,
            "WorkPulse could not start safely. No new tracking session was authorized. "
            "Check WorkPulse logs and configuration, then restart. If logging is unavailable, check the logs folder permissions.",
            "WorkPulse Agent — startup error", 0x10)
    except Exception:
        pass


def launch(entry):
    """Guard the GUI/CLI dispatcher; never dump sensitive raw exceptions."""
    try:
        def uncaught(_type, _value, _traceback):
            record_failure()
            show_startup_error()
        sys.excepthook = uncaught
        def thread_error(_args):
            record_failure("desktop_thread_error")
        threading.excepthook = thread_error
        return entry()
    except (Exception, KeyboardInterrupt):
        record_failure()
        if "--gui-smoke-test" not in sys.argv:
            show_startup_error()
        return 1
