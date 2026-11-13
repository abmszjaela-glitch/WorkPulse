"""Strict allowlisting of aggregate activity before any local persistence."""

import hashlib
import json
import math
import re
from datetime import datetime, timezone

from .queue_errors import QueueValidationError


def _utc(value) -> datetime:
    try:
        result = datetime.fromisoformat(value) if isinstance(value, str) else value
        if not isinstance(result, datetime) or result.tzinfo is None or result.utcoffset() is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        raise QueueValidationError("Interval boundaries must be timezone-aware timestamps.") from None


def _seconds(value) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise QueueValidationError("Activity durations must be finite non-negative numbers.")
    return float(value)


def canonical_record(employee_id, interval_start, interval_end, summary):
    """Return canonical safe payload bytes, hashes and the UTC interval end.

    Score calibration metadata from ActivityCalculator is accepted but not stored.
    Unknown fields (including credentials or content fields) are rejected.
    """
    if not isinstance(employee_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}", employee_id):
        raise QueueValidationError("Employee ID must be a bounded identifier.")
    start, end = _utc(interval_start), _utc(interval_end)
    if end < start:
        raise QueueValidationError("Interval end must not precede interval start.")
    required = {"interval_seconds", "counts", "active_seconds", "idle_seconds", "application_usage_seconds"}
    allowed = required | {
        "configured_interval_seconds", "status", "activity_score", "score_type",
        "score_is_productivity_or_performance", "score_weights",
        "reference_counts_per_minute", "cumulative_application_usage_seconds",
    }
    if not isinstance(summary, dict) or not required <= summary.keys() or summary.keys() - allowed:
        raise QueueValidationError("Only the defined aggregate activity fields are accepted.")
    counts = summary["counts"]
    expected = {"mouse_movements", "mouse_clicks", "key_presses"}
    if (not isinstance(counts, dict) or set(counts) != expected
            or any(type(value) is not int or value < 0 or value > 2**63 - 1 for value in counts.values())):
        raise QueueValidationError("Only non-negative aggregate input counters are accepted.")
    elapsed = _seconds(summary["interval_seconds"])
    active, idle = _seconds(summary["active_seconds"]), _seconds(summary["idle_seconds"])
    if not math.isclose(active + idle, elapsed, rel_tol=1e-6, abs_tol=1e-6):
        raise QueueValidationError("Active and idle duration must total the interval duration.")
    apps = summary["application_usage_seconds"]
    if not isinstance(apps, dict) or len(apps) > 256:
        raise QueueValidationError("Application usage must be a bounded name-to-duration mapping.")
    app_usage = {}
    for name, seconds in apps.items():
        if (not isinstance(name, str) or not name.strip() or len(name) > 255
                or re.search(r'[\x00-\x1f<>:"/\\|?*]', name)):
            raise QueueValidationError("Application usage accepts process names only, not paths or content.")
        app_usage[name] = _seconds(seconds)
    safe_summary = {
        "interval_seconds": elapsed, "counts": dict(counts),
        "active_seconds": active, "idle_seconds": idle,
        "application_usage_seconds": app_usage,
    }
    if "status" in summary:
        if summary["status"] not in ("ACTIVE", "IDLE"):
            raise QueueValidationError("Invalid activity status.")
        safe_summary["status"] = summary["status"]
    if "activity_score" in summary:
        score = _seconds(summary["activity_score"])
        if score > 100:
            raise QueueValidationError("Activity score must be between zero and one hundred.")
        safe_summary.update(activity_score=score, score_type="input_activity_intensity",
                            score_is_productivity_or_performance=False)
    body = {
        "employee_id": employee_id,
        "interval_start": start.isoformat(timespec="microseconds"),
        "interval_end": end.isoformat(timespec="microseconds"),
        "summary": safe_summary,
    }
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    identity = json.dumps([body["employee_id"], body["interval_start"], body["interval_end"]], separators=(",", ":")).encode("utf-8")
    return encoded, hashlib.sha256(identity).digest(), hashlib.sha256(encoded).digest(), end.timestamp()
