"""Opt-in, constant-memory resource sampler for this agent process only."""
from math import isfinite
import os
from threading import Event, Lock, Thread
from time import monotonic

import psutil

if __package__ == "core":
    from config import config
else:
    from ..config import config


def thresholds():
    return {
        "average_cpu_percent": config.PERF_MAX_AVG_CPU_PERCENT,
        "peak_cpu_percent": config.PERF_MAX_PEAK_CPU_PERCENT,
        "peak_memory_mb": config.PERF_MAX_MEMORY_MB,
        "rss_growth_mb": config.PERF_MAX_RSS_GROWTH_MB,
    }


class ProcessPerformanceMonitor:
    """Process CPU: 100% equals one fully occupied logical CPU, may exceed 100.

    CPU uses user+system CPU-time deltas over real monotonic elapsed time.
    Memory is resident working-set (RSS), in decimal MB (1,000,000 bytes).
    Sampled peaks can miss shorter spikes. No process enumeration, command lines,
    foreground lookup, child processes, usernames, or activity payloads are read.
    """
    def __init__(self, *, interval=None):
        self.interval = config.PERF_SAMPLE_SECONDS if interval is None else interval
        if not isinstance(self.interval, (int, float)) or not isfinite(self.interval) or self.interval < 0.1:
            raise ValueError("Performance sampling interval must be at least 0.1 seconds.")
        self._process = psutil.Process(os.getpid())
        self._stop = Event()
        self._lock = Lock()
        self._thread = None
        self._first = self._last = None
        self._count = 0
        self._cpu_peak = self._rss_peak = self._threads_peak = 0
        self._rss_integral = 0.0
        self._error = False

    def _capture(self):
        with self._process.oneshot():
            cpu = self._process.cpu_times()
            return (monotonic(), cpu.user + cpu.system,
                    self._process.memory_info().rss / 1_000_000,
                    self._process.num_threads())

    def _sample(self):
        current = self._capture()
        with self._lock:
            if self._first is None:
                self._first = current
            if self._last is not None:
                seconds = current[0] - self._last[0]
                if seconds > 0:
                    self._cpu_peak = max(self._cpu_peak, max(0, current[1] - self._last[1]) / seconds * 100)
                    self._rss_integral += seconds * (self._last[2] + current[2]) / 2
            self._last = current
            self._count += 1
            self._rss_peak = max(self._rss_peak, current[2])
            self._threads_peak = max(self._threads_peak, current[3])

    def _run(self):
        try:
            while not self._stop.wait(self.interval):
                self._sample()
        except Exception:
            self._error = True  # Sanitized status only; no raw native exceptions.

    def start(self):
        if self._thread is not None:
            raise RuntimeError("A performance measurement cannot be restarted.")
        self._sample()  # Establish baseline; no bogus first cpu_percent reading.
        self._thread = Thread(target=self._run, name="WorkPulse performance sampler")
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        if self._thread is None:
            raise RuntimeError("Performance measurement has not started.")
        self._thread.join()
        if not self._error:
            self._sample()
        return self.result()

    def result(self):
        with self._lock:
            if self._first is None or self._last is None:
                raise RuntimeError("No performance samples are available.")
            duration = max(0, self._last[0] - self._first[0])
            average = max(0, self._last[1] - self._first[1]) / duration * 100 if duration else 0
            result = {
                "duration_seconds": round(duration, 4), "sample_count": self._count,
                "average_cpu_percent": round(average, 4),
                "peak_cpu_percent": round(self._cpu_peak, 4),
                "start_memory_mb": round(self._first[2], 4),
                "end_memory_mb": round(self._last[2], 4),
                "average_memory_mb": round(self._rss_integral / duration if duration else self._last[2], 4),
                "peak_memory_mb": round(self._rss_peak, 4),
                "rss_growth_mb": round(self._last[2] - self._first[2], 4),
                "start_os_threads": self._first[3],
                "peak_os_threads": self._threads_peak,
                "sampling_error": self._error,
            }
            result["threshold_exceedances"] = [name for name, limit in thresholds().items() if result[name] > limit]
            if self._threads_peak - self._first[3] > config.PERF_MAX_ADDITIONAL_THREADS:
                result["threshold_exceedances"].append("additional_os_threads")
            return result

    def __enter__(self):
        return self.start()

    def __exit__(self, *_):
        self.stop()
