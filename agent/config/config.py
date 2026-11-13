"""Central configuration for the desktop agent.

Set SERVER_URL, TRACKING_INTERVAL, IDLE_THRESHOLD, or ACTIVE_WINDOW_INTERVAL in
the environment before starting. Configuration is read once on module import.
Other modules should import these constants rather than define their own values.
"""

import os
from math import isfinite
from pathlib import Path
from urllib.parse import urlsplit


def _positive_integer(name: str, default: int) -> int:
    """Read a positive integer setting, rejecting invalid overrides early."""
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    try:
        value = int(raw_value)
    except ValueError:
        raise ValueError(f"{name} must be a positive integer.") from None

    if value <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return value


def _positive_seconds(name: str, default: int) -> int:
    """Read a positive integer duration, in seconds."""
    return _positive_integer(name, default)


# Backend API base URL. Override this with the deployed API address in production.
# No authentication tokens, API keys, or credentials belong in this module.
SERVER_URL: str = os.environ.get("SERVER_URL", "http://localhost:5000/api").strip().rstrip("/")

try:
    _server_url = urlsplit(SERVER_URL)
    if _server_url.scheme not in ("http", "https") or not _server_url.hostname:
        raise ValueError
    # Accessing port also rejects malformed or out-of-range port overrides.
    _server_url.port
except ValueError:
    raise ValueError("SERVER_URL must be a valid absolute HTTP or HTTPS URL.") from None

# Default sampling cadence: once per minute. This module does not start tracking.
TRACKING_INTERVAL: int = _positive_seconds("TRACKING_INTERVAL", 60)

# Default inactivity duration before the agent considers the user idle: 5 minutes.
IDLE_THRESHOLD: int = _positive_seconds("IDLE_THRESHOLD", 300)

# Foreground process-name polling cadence, independent of summary reporting.
ACTIVE_WINDOW_INTERVAL: int = _positive_seconds("ACTIVE_WINDOW_INTERVAL", 2)


def _score_number(name: str, default: float, *, allow_zero: bool = False) -> float:
    """Read a finite score parameter without allowing invalid denominators."""
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a valid numeric score parameter.") from None
    if not isfinite(value) or value < 0 or (value == 0 and not allow_zero):
        raise ValueError(f"{name} must be finite and {'non-negative' if allow_zero else 'positive'}.")
    return value


# Input-intensity weights, NOT productivity/performance measures. Weights are
# normalized by their sum; a zero weight disables that input's contribution.
ACTIVITY_SCORE_WEIGHTS: dict[str, float] = {
    "mouse_movements": _score_number("ACTIVITY_MOVEMENT_WEIGHT", 0.2, allow_zero=True),
    "mouse_clicks": _score_number("ACTIVITY_CLICK_WEIGHT", 0.3, allow_zero=True),
    "key_presses": _score_number("ACTIVITY_KEY_WEIGHT", 0.5, allow_zero=True),
}
if not isfinite(sum(ACTIVITY_SCORE_WEIGHTS.values())) or sum(ACTIVITY_SCORE_WEIGHTS.values()) <= 0:
    raise ValueError("Activity score weights must have a finite, positive sum.")

# At these per-minute event rates each component reaches its cap of 1.0.
# These are calibration defaults, not targets or judgments about a user's work.
ACTIVITY_REFERENCE_COUNTS_PER_MINUTE: dict[str, float] = {
    "mouse_movements": _score_number("ACTIVITY_MOVEMENTS_PER_MINUTE", 120.0),
    "mouse_clicks": _score_number("ACTIVITY_CLICKS_PER_MINUTE", 30.0),
    "key_presses": _score_number("ACTIVITY_KEYS_PER_MINUTE", 120.0),
}

# This module only defines paths. A database is created only when OfflineQueue
# is explicitly constructed. The parent must be a dedicated, private directory.
def _offline_queue_path() -> Path | None:
    override = os.environ.get("OFFLINE_QUEUE_PATH")
    if override is not None:
        if not override.strip():
            raise ValueError("OFFLINE_QUEUE_PATH must not be blank.")
        return Path(override)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "WorkPulse" / "queue" / "activity.sqlite3"
    # Importing unrelated tracking configuration must not require a user profile.
    # Queue construction fails closed unless an explicit local path is provided.
    return None


OFFLINE_QUEUE_PATH: Path | None = _offline_queue_path()
OFFLINE_QUEUE_RETENTION_DAYS: int = _positive_integer("OFFLINE_QUEUE_RETENTION_DAYS", 7)
OFFLINE_QUEUE_MAX_RECORDS: int = _positive_integer("OFFLINE_QUEUE_MAX_RECORDS", 10000)
OFFLINE_QUEUE_MAX_BYTES: int = _positive_integer("OFFLINE_QUEUE_MAX_BYTES", 64 * 1024 * 1024)
OFFLINE_QUEUE_MAX_RECORD_BYTES: int = _positive_integer("OFFLINE_QUEUE_MAX_RECORD_BYTES", 64 * 1024)
OFFLINE_QUEUE_DB_TIMEOUT: int = _positive_seconds("OFFLINE_QUEUE_DB_TIMEOUT", 5)
