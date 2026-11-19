# WorkPulse Agent measured performance

Run UTC: 2026-11-19T10:37:58.578870+00:00

Controlled tracker benchmark; not a production certification. Only the current Python process was sampled.

CPU 100% = one logical CPU; MB = 1,000,000 bytes. Peaks are sampled. Sampler overhead is included.

| Scenario | Status | Seconds | CPU avg % | CPU peak % | RSS avg MB | RSS peak MB |
|---|---|---:|---:|---:|---:|---:|
| paused | measured | 15.0122 | 0.9367 | 1.919 | 32.7791 | 32.8294 |
| idle | measured | 15.0538 | 1.1417 | 2.0275 | 32.4827 | 32.9646 |
| active | measured | 15.0131 | 0.8326 | 3.0716 | 33.0762 | 33.1162 |
| backend_synchronization | not_measured | — | — | — | — | — |

## Method and limits

15s per phase, 1s resource sampling, target 20 synthetic active ticks/s (one movement, click and key count per tick). Native mouse/keyboard listeners plus foreground poller; OS callbacks discard data. Summary interval remains 60s.

Real backend synchronization was not measured: no sender/API contract or authenticated session exists.
Idle uses a test-only one-second threshold; active injects fabricated count events. Real OS event arguments are discarded. No employee process lookup occurs.
The full UI, authenticated queue-upload path, startup costs and long-duration workloads are not represented.
A phase shorter than the configured summary interval does not measure a periodic full-summary calculation. Synthetic event rate is a target; achieved counts and rate are in the JSON.

## Thresholds

```json
{
  "average_cpu_percent": 5,
  "peak_cpu_percent": 25,
  "peak_memory_mb": 200,
  "rss_growth_mb": 10,
  "retained_python_growth_mb": 2,
  "additional_os_threads": 8
}
```

## Listener stability and growth

```json
{
  "status": "measured",
  "cycles": 10,
  "rss_growth_mb": 0.2949,
  "retained_python_growth_mb": 0.0024,
  "retained_python_bytes_after_each_cycle": [
    624,
    736,
    1392,
    1504,
    1648,
    1792,
    1904,
    2016,
    2192,
    2368
  ],
  "remaining_additional_python_threads": [],
  "retained_tracker_fixtures": 0,
  "suspected_leaks_or_unnecessary_threads": [],
  "limitation": "Short-run growth is a leak signal, not proof. Allocators cache memory; long soak tests are required."
}
```

## Findings

- No configured threshold exceeded in this short controlled run; this does not establish absence of leaks or production overhead.
