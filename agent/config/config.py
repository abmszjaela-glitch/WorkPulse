"""Central configuration for the desktop agent.

Set SERVER_URL, TRACKING_INTERVAL, or IDLE_THRESHOLD in the environment before
starting the agent. Configuration is read once when this module is imported.
Other modules should import these constants rather than define their own values.
"""

import os
from urllib.parse import urlsplit


def _positive_seconds(name: str, default: int) -> int:
    """Read a positive integer duration, rejecting invalid overrides early."""
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    try:
        value = int(raw_value)
    except ValueError:
        raise ValueError(f"{name} must be a positive integer in seconds.") from None

    if value <= 0:
        raise ValueError(f"{name} must be a positive integer in seconds.")
    return value


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
