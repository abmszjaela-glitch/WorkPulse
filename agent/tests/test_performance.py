"""Deterministic process-only sampler tests; no employee activity capture."""
from contextlib import nullcontext
from types import SimpleNamespace
import os
import unittest
from unittest.mock import Mock, patch

from agent.core.performance import ProcessPerformanceMonitor


class PerformanceTests(unittest.TestCase):
    def test_average_peak_units_thresholds_and_only_current_process(self):
        process = Mock()
        process.oneshot.side_effect = lambda: nullcontext()
        process.cpu_times.side_effect = [SimpleNamespace(user=1, system=1), SimpleNamespace(user=1.2, system=1.1), SimpleNamespace(user=1.6, system=1.4)]
        process.memory_info.side_effect = [SimpleNamespace(rss=10_000_000), SimpleNamespace(rss=12_000_000), SimpleNamespace(rss=14_000_000)]
        process.num_threads.side_effect = [1, 2, 1]
        with patch("agent.core.performance.psutil.Process", return_value=process) as factory, patch("agent.core.performance.monotonic", side_effect=[0, 1, 2]):
            monitor = ProcessPerformanceMonitor()
            for _ in range(3):
                monitor._sample()
            result = monitor.result()
        factory.assert_called_once_with(os.getpid())
        self.assertEqual(result["average_cpu_percent"], 50)
        self.assertEqual(result["peak_cpu_percent"], 70)
        self.assertEqual(result["average_memory_mb"], 12)
        self.assertEqual(result["peak_memory_mb"], 14)
        self.assertEqual(result["rss_growth_mb"], 4)
        self.assertEqual(result["peak_os_threads"], 2)
        self.assertIn("average_cpu_percent", result["threshold_exceedances"])
        self.assertIn("peak_cpu_percent", result["threshold_exceedances"])

    def test_empty_duration_does_not_divide_by_zero(self):
        monitor = ProcessPerformanceMonitor()
        with patch.object(monitor, "_capture", return_value=(0, 0, 1, 1)):
            monitor._sample()
            monitor._sample()
        self.assertEqual(monitor.result()["average_cpu_percent"], 0)
        self.assertEqual(monitor.result()["average_memory_mb"], 1)

    def test_constant_memory_sampling_and_interruptible_shutdown(self):
        monitor = ProcessPerformanceMonitor(interval=30)
        monitor.start()
        worker = monitor._thread
        result = monitor.stop()
        self.assertFalse(worker.is_alive())
        self.assertGreaterEqual(result["sample_count"], 2)
        self.assertLess(result["duration_seconds"], 2)
        self.assertFalse(any(isinstance(value, list) for value in vars(monitor).values()))

    def test_invalid_polling_intervals_are_rejected(self):
        for value in (0, -1, 0.001, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ProcessPerformanceMonitor(interval=value)

    def test_sampling_failure_is_reported_without_raw_error(self):
        monitor = ProcessPerformanceMonitor(interval=0.1)
        with patch.object(monitor, "_sample", side_effect=RuntimeError("private native details")), patch.object(monitor._stop, "wait", return_value=False):
            monitor._run()
        self.assertTrue(monitor._error)


if __name__ == "__main__":
    unittest.main()
