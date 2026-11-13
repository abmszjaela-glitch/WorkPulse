"""Interval summaries of anonymous input intensity, never work performance."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite
from threading import RLock
from time import monotonic

from .app_usage_tracker import AppUsageTracker
from .idle_detector import IdleDetector
from .keyboard_tracker import KeyboardTracker
from .mouse_tracker import MouseTracker

if __package__ == "tracker":
    from config import config
else:
    from ..config import config


@dataclass(frozen=True)
class _Sample:
    timestamp: float
    counts: dict[str, int]
    active_elapsed: float
    apps: dict[str, float]
    status: str


class ActivityCalculator:
    """Calculate summaries on demand without starting another reporting thread.

    Call start() when collection begins, then calculate_summary() periodically.
    Before the configured interval is due, it returns None; force=True flushes a
    partial interval. Late calls summarize actual elapsed time, not invented bins.

    Interval counts use committed cursors over cumulative tracker counters. Only
    after a JSON-valid summary exists are those cursors advanced. This resets the
    calculator's interval counts while preserving the existing cumulative inputs
    and application usage. Do not externally reset raw input counters while this
    calculator is attached; start a new calculator session if that is necessary.
    """

    _SIGNALS = ("mouse_movements", "mouse_clicks", "key_presses")

    def __init__(
        self,
        mouse_tracker: MouseTracker,
        keyboard_tracker: KeyboardTracker,
        idle_detector: IdleDetector,
        app_usage_tracker: AppUsageTracker | None = None,
        *,
        interval: float | None = None,
        weights: Mapping[str, float] | None = None,
        reference_counts_per_minute: Mapping[str, float] | None = None,
    ) -> None:
        if (mouse_tracker.activity_state is not idle_detector.activity_state
                or keyboard_tracker.activity_state is not idle_detector.activity_state):
            raise ValueError("Input trackers and IdleDetector must share ActivityState.")
        if interval is not None and (not isfinite(interval) or interval <= 0):
            raise ValueError("Activity summary interval must be finite and positive.")
        self._mouse = mouse_tracker
        self._keyboard = keyboard_tracker
        self._idle = idle_detector
        self._usage = app_usage_tracker
        self._interval = interval
        self._weights = self._policy(
            config.ACTIVITY_SCORE_WEIGHTS if weights is None else weights, allow_zero=True
        )
        self._references = self._policy(
            config.ACTIVITY_REFERENCE_COUNTS_PER_MINUTE
            if reference_counts_per_minute is None else reference_counts_per_minute,
            allow_zero=False,
        )
        total_weight = sum(self._weights.values())
        if not isfinite(total_weight) or total_weight <= 0:
            raise ValueError("Activity weights must have a finite, positive sum.")
        self._weight_total = total_weight
        self._lock = RLock()
        self._baseline: _Sample | None = None

    @classmethod
    def _policy(cls, values: Mapping[str, float], *, allow_zero: bool) -> dict[str, float]:
        if set(values) != set(cls._SIGNALS):
            raise ValueError("Score parameters must contain exactly the three input signals.")
        policy = {name: float(values[name]) for name in cls._SIGNALS}
        if any(not isfinite(value) or value < 0 or (not allow_zero and value == 0)
               for value in policy.values()):
            raise ValueError("Score parameters must be finite and within their allowed range.")
        return policy

    @property
    def interval(self) -> float:
        return self._interval if self._interval is not None else config.TRACKING_INTERVAL

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._baseline is not None

    def _capture(self) -> _Sample:
        apps = self._usage.get_usage_summary(cumulative=True) if self._usage else {}
        mouse = self._mouse.get_counts()
        keyboard = self._keyboard.get_counts()
        counts = {
            "mouse_movements": mouse["movement_count"],
            "mouse_clicks": mouse["click_count"],
            "key_presses": keyboard["key_press_count"],
        }
        if any(type(value) is not int or value < 0 for value in counts.values()):
            raise ValueError("Activity counters must be non-negative integers.")
        if any(not isinstance(name, str) or not isinstance(value, (int, float))
               or not isfinite(value) or value < 0 for name, value in apps.items()):
            raise ValueError("Application usage must contain names and finite durations only.")
        active_elapsed = self._idle.get_active_elapsed()
        timestamp = monotonic()
        status = self._idle.get_status()
        if (not isfinite(timestamp) or not isfinite(active_elapsed)
                or active_elapsed < 0 or status not in ("ACTIVE", "IDLE")):
            raise ValueError("Activity timing or status is invalid.")
        return _Sample(timestamp, counts, active_elapsed, dict(apps), status)

    def start(self) -> None:
        """Begin at current cumulative values, ignoring events before this session."""
        with self._lock:
            if self._baseline is None:
                self._baseline = self._capture()

    def _score(self, counts: dict[str, int], elapsed: float) -> float:
        if elapsed <= 0:
            return 0.0
        # Capped per-signal rate divided by its reference, then weighted mean.
        # Full elapsed time is used, so idle portions do not inflate event rates.
        weighted = sum(
            self._weights[name] * min(1.0, counts[name] / elapsed * 60 / self._references[name])
            for name in self._SIGNALS
        )
        return round(max(0.0, min(100.0, weighted / self._weight_total * 100)), 2)

    def calculate_summary(self, *, force: bool = False) -> dict | None:
        """Create one JSON-compatible interval summary and commit its reset once."""
        with self._lock:
            previous = self._baseline
            if previous is None:
                raise RuntimeError("Start the activity calculator before requesting summaries.")
            if not force and monotonic() - previous.timestamp < self.interval:
                return None
            current = self._capture()
            elapsed = max(0.0, current.timestamp - previous.timestamp)
            counts = {
                name: current.counts[name] - previous.counts[name]
                for name in self._SIGNALS
            }
            if any(value < 0 for value in counts.values()):
                raise RuntimeError("Raw counters were reset externally; restart the calculator.")
            active = min(elapsed, max(0.0, current.active_elapsed - previous.active_elapsed))
            apps = {
                name: seconds - previous.apps.get(name, 0.0)
                for name, seconds in current.apps.items()
                if seconds > previous.apps.get(name, 0.0)
            }
            summary = {
                "interval_seconds": elapsed,
                "configured_interval_seconds": self.interval,
                "counts": counts,
                "active_seconds": active,
                "idle_seconds": max(0.0, elapsed - active),
                "status": current.status,
                "activity_score": self._score(counts, elapsed),
                "score_type": "input_activity_intensity",
                "score_is_productivity_or_performance": False,
                "score_weights": dict(self._weights),
                "reference_counts_per_minute": dict(self._references),
                "application_usage_seconds": apps,
                "cumulative_application_usage_seconds": dict(current.apps),
            }
            # A failed build/serialization must not consume counters or durations.
            json.dumps(summary, allow_nan=False)
            self._baseline = current
            return summary

    def stop(self) -> dict | None:
        """Flush a final partial interval, without stopping any input dependencies."""
        with self._lock:
            if self._baseline is None:
                return None
            summary = self.calculate_summary(force=True)
            self._baseline = None
            return summary
