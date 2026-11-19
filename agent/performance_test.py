"""Opt-in reproducible resource test: python -m agent.performance_test.

Native listener threads discard every real OS event. Synthetic calls exercise
only anonymous counters. Foreground lookup is replaced; no other process is
inspected. This is a controlled tracker benchmark, not a production agent/sync
benchmark. Normal tracking, startup entries and authentication are untouched.
"""
from datetime import datetime, timezone
import gc
import json
from pathlib import Path
import platform
from threading import Event, enumerate as local_threads
from time import monotonic
import tracemalloc
import weakref

import psutil
from pynput import keyboard, mouse

from .config import config
from .core.performance import ProcessPerformanceMonitor, thresholds
from .tracker.activity_state import ActivityState
from .tracker.mouse_tracker import MouseTracker
from .tracker.keyboard_tracker import KeyboardTracker
from .tracker.idle_detector import IdleDetector
from .tracker.active_window_tracker import ActiveWindowTracker
from .tracker.app_usage_tracker import AppUsageTracker
from .tracker.activity_calculator import ActivityCalculator


def discard(*_):
    """Drop OS-provided event arguments without inspecting or retaining them."""


class TestMouse(MouseTracker):
    def _create_listener(self):
        return mouse.Listener(on_move=discard, on_click=discard)


class TestKeyboard(KeyboardTracker):
    def _create_listener(self):
        return keyboard.Listener(on_press=discard)


class TestForeground(ActiveWindowTracker):
    @staticmethod
    def _detect_application():
        return "synthetic-benchmark.exe"


class TestIdle(IdleDetector):
    # A short test-only idle threshold keeps idle measurement practical. Never
    # mutate the production setting or wait five minutes before a smoke test.
    THRESHOLD_SECONDS = 1

    def get_status(self):
        return "IDLE" if self.get_inactivity_duration() >= self.THRESHOLD_SECONDS else "ACTIVE"

    def get_active_elapsed(self):
        return self.activity_state.active_elapsed(self.THRESHOLD_SECONDS)


class TrackerFixture:
    def __init__(self):
        state = ActivityState()
        self.mouse, self.keyboard = TestMouse(state), TestKeyboard(state)
        self.foreground, self.idle = TestForeground(), TestIdle(state)
        self.usage = AppUsageTracker(self.foreground, self.idle)
        self.calculator = ActivityCalculator(self.mouse, self.keyboard, self.idle, self.usage)
        self.trackers = (self.mouse, self.keyboard, self.usage, self.foreground)

    def __enter__(self):
        try:
            for tracker in self.trackers:
                tracker.start()
            self.calculator.start()
            return self
        except BaseException:
            self.close()
            raise

    def close(self):
        failed = False
        for tracker in reversed(self.trackers):
            try:
                tracker.stop()
            except Exception:
                failed = True
        self.calculator.stop()
        if failed or any(tracker.is_running for tracker in self.trackers):
            raise RuntimeError("Test listener shutdown could not be confirmed.")

    def __exit__(self, *_):
        self.close()

    def synthetic_tick(self):
        self.mouse._on_move(0, 0)
        self.mouse._on_click(0, 0, None, True)
        self.keyboard._on_press(None)


def measure_phase(name, fixture=None):
    stop = Event()
    if name == "idle":
        stop.wait(TestIdle.THRESHOLD_SECONDS + 0.1)
    with ProcessPerformanceMonitor() as monitor:
        deadline = monotonic() + config.PERF_PHASE_SECONDS
        next_summary = monotonic()
        while monotonic() < deadline:
            if name == "active":
                fixture.synthetic_tick()
            if fixture is not None and monotonic() >= next_summary:
                fixture.calculator.calculate_summary()
                next_summary = monotonic() + config.PERF_SAMPLE_SECONDS
            delay = 1 / config.PERF_EVENT_HZ if name == "active" else config.PERF_SAMPLE_SECONDS
            stop.wait(min(delay, max(0, deadline - monotonic())))
    result = monitor.result()
    result["status"] = "measured"
    result["mode"] = "No listeners; process baseline" if fixture is None else "Native listener threads; real input discarded; synthetic foreground"
    if fixture is not None:
        result["observed_activity_status"] = fixture.idle.get_status()
        result["synthetic_counts"] = {**fixture.mouse.get_counts(), **fixture.keyboard.get_counts()}
        if name == "active":
            result["achieved_synthetic_ticks_per_second"] = round(
                result["synthetic_counts"]["key_press_count"] / result["duration_seconds"], 4)
        result["listeners_healthy_at_end"] = all(tracker.is_running for tracker in fixture.trackers)
    return result


def lifecycle_test():
    """Warm allocator/backend first, then look for retained objects/threads/growth."""
    with TrackerFixture():
        Event().wait(0.2)
    gc.collect()
    process = psutil.Process()  # Current process only.
    baseline_threads = {thread.ident for thread in local_threads()}
    rss_before = process.memory_info().rss / 1_000_000
    tracemalloc.start()
    python_before = tracemalloc.get_traced_memory()[0]
    retained = []
    refs = []
    for _ in range(config.PERF_LIFECYCLE_CYCLES):
        with TrackerFixture() as fixture:
            fixture.synthetic_tick()
            if not all(tracker.is_running for tracker in fixture.trackers):
                raise RuntimeError("Listener stopped unexpectedly during lifecycle test.")
            Event().wait(0.1)
        refs.append(weakref.ref(fixture))
        del fixture
        gc.collect()
        retained.append(tracemalloc.get_traced_memory()[0])
    Event().wait(0.5)
    gc.collect()
    python_growth = (tracemalloc.get_traced_memory()[0] - python_before) / 1_000_000
    tracemalloc.stop()
    rss_growth = process.memory_info().rss / 1_000_000 - rss_before
    extra = [thread.name for thread in local_threads() if thread.ident not in baseline_threads]
    suspects = []
    if rss_growth > config.PERF_MAX_RSS_GROWTH_MB:
        suspects.append("RSS growth exceeds threshold")
    if python_growth > config.PERF_MAX_PYTHON_GROWTH_MB:
        suspects.append("Retained Python allocation growth exceeds threshold")
    retained_fixtures = sum(ref() is not None for ref in refs)
    if retained_fixtures:
        suspects.append("Tracker fixture objects retained after collection")
    if extra:
        suspects.append("Additional Python threads remain after shutdown")
    return {
        "status": "measured", "cycles": config.PERF_LIFECYCLE_CYCLES,
        "rss_growth_mb": round(rss_growth, 4),
        "retained_python_growth_mb": round(python_growth, 4),
        "retained_python_bytes_after_each_cycle": retained,
        "remaining_additional_python_threads": extra,
        "retained_tracker_fixtures": retained_fixtures,
        "suspected_leaks_or_unnecessary_threads": suspects,
        "limitation": "Short-run growth is a leak signal, not proof. Allocators cache memory; long soak tests are required.",
    }


def write_report(report, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    json_path, markdown_path = directory / "performance-results.json", directory / "performance-report.md"
    json_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = ["# WorkPulse Agent measured performance", "", f"Run UTC: {report['started_at_utc']}", "",
             "Controlled tracker benchmark; not a production certification. Only the current Python process was sampled.", "",
             "CPU 100% = one logical CPU; MB = 1,000,000 bytes. Peaks are sampled. Sampler overhead is included.", "",
             "| Scenario | Status | Seconds | CPU avg % | CPU peak % | RSS avg MB | RSS peak MB |",
             "|---|---|---:|---:|---:|---:|---:|"]
    for name, result in report["scenarios"].items():
        if result["status"] == "measured":
            lines.append(f"| {name} | measured | {result['duration_seconds']} | {result['average_cpu_percent']} | {result['peak_cpu_percent']} | {result['average_memory_mb']} | {result['peak_memory_mb']} |")
        else:
            lines.append(f"| {name} | {result['status']} | — | — | — | — | — |")
    lines += ["", "## Method and limits", "", report["method"], "", "Real backend synchronization was not measured: no sender/API contract or authenticated session exists.",
              "Idle uses a test-only one-second threshold; active injects fabricated count events. Real OS event arguments are discarded. No employee process lookup occurs.",
              "The full UI, authenticated queue-upload path, startup costs and long-duration workloads are not represented.",
              "A phase shorter than the configured summary interval does not measure a periodic full-summary calculation. Synthetic event rate is a target; achieved counts and rate are in the JSON.",
              "", "## Thresholds", "", "```json", json.dumps(report["thresholds"], indent=2), "```", "",
              "## Listener stability and growth", "", "```json", json.dumps(report["lifecycle"], indent=2), "```", "",
              "## Findings", ""]
    lines += ["- " + finding for finding in report["findings"]]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return markdown_path


def main():
    print("Visible WorkPulse performance test. Real input is discarded; no uploads or startup changes.", flush=True)
    report = {
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "python_version": platform.python_version(), "psutil_version": psutil.__version__,
        "method": f"{config.PERF_PHASE_SECONDS}s per phase, {config.PERF_SAMPLE_SECONDS}s resource sampling, target {config.PERF_EVENT_HZ} synthetic active ticks/s (one movement, click and key count per tick). Native mouse/keyboard listeners plus foreground poller; OS callbacks discard data. Summary interval remains {config.TRACKING_INTERVAL}s.",
        "thresholds": {**thresholds(), "retained_python_growth_mb": config.PERF_MAX_PYTHON_GROWTH_MB,
                       "additional_os_threads": config.PERF_MAX_ADDITIONAL_THREADS},
        "scenarios": {}, "findings": [],
    }
    try:
        # Warm native imports/listener backend before taking phase measurements.
        with TrackerFixture():
            Event().wait(0.2)
        print("Measuring paused baseline...", flush=True)
        report["scenarios"]["paused"] = measure_phase("paused")
        for name in ("idle", "active"):
            print(f"Measuring {name} tracking...", flush=True)
            with TrackerFixture() as fixture:
                report["scenarios"][name] = measure_phase(name, fixture)
        report["scenarios"]["backend_synchronization"] = {
            "status": "not_measured", "reason": "No implemented sender, backend upload contract or authenticated session. No simulated HTTP results substituted."}
        print("Testing repeated listener startup/shutdown and retained memory...", flush=True)
        report["lifecycle"] = lifecycle_test()
        for name, result in report["scenarios"].items():
            for exceeded in result.get("threshold_exceedances", []):
                report["findings"].append(f"{name}: exceeds {exceeded} threshold")
            if result.get("sampling_error") or result.get("listeners_healthy_at_end") is False:
                report["findings"].append(f"{name}: sampling/listener failure")
        report["findings"] += report["lifecycle"]["suspected_leaks_or_unnecessary_threads"]
        if not report["findings"]:
            report["findings"].append("No configured threshold exceeded in this short controlled run; this does not establish absence of leaks or production overhead.")
    except (Exception, KeyboardInterrupt):
        report["findings"].append("Benchmark interrupted or failed; incomplete results are not a pass.")
        report.setdefault("lifecycle", {"status": "not_measured"})
        report["scenarios"].setdefault("backend_synchronization", {"status": "not_measured"})
        print(write_report(report, config.PERF_REPORT_DIRECTORY), flush=True)
        return 1
    print(write_report(report, config.PERF_REPORT_DIRECTORY), flush=True)
    return int(any(result.get("threshold_exceedances") or result.get("sampling_error") or result.get("listeners_healthy_at_end") is False for result in report["scenarios"].values())
               or bool(report["lifecycle"]["suspected_leaks_or_unnecessary_threads"]))


if __name__ == "__main__":
    raise SystemExit(main())
