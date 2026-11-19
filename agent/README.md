# Foreground activity agent

From the repository root, start the agent explicitly in a visible terminal:

```powershell
.\agent\venv\Scripts\python.exe -m agent.core.agent
```

Alternatively, from the `agent` directory, use `python -m core.agent` with the
virtual environment activated. Importing the module does not start tracking.

The agent announces when tracking starts, prints cumulative mouse movement,
mouse click and anonymous key press counts with `ACTIVE`/`IDLE` status and the
current foreground process name, and prints a final summary on normal shutdown.
It stores no window titles, document names, URLs, coordinates, individual keys,
typed text or screenshots. Data stays in memory; no API requests, persistent
files, services or autostart entries are created.

Set `TRACKING_INTERVAL`, `IDLE_THRESHOLD`, and `ACTIVE_WINDOW_INTERVAL` environment
variables (seconds) before launch to override the defaults in `config/config.py`.
Foreground detection uses the existing Windows `pywin32` and `psutil` dependencies.
It checks the foreground handle, resolves the process ID, and reads only the
process name. Inaccessible or terminated processes yield `Unavailable`.

`ActiveWindowTracker.get_active_app()` returns the current process name or `None`.
`get_snapshot()` returns an immutable name/monotonic-start-time pair. The start
time changes when a different app is observed; switching windows within the same
application does not reset it. Only the current snapshot is retained. Polling can
miss changes shorter than its interval, and app changes do not reset input idle
timing.

Press **Ctrl+C** to request shutdown. The CLI also handles SIGTERM. Embedded
callers can use `ActivityAgent.stop()` to interrupt the reporting wait. Both
listeners are stopped in cleanup, including when startup or reporting fails.
Listener shutdown is bounded; failures are reported with a nonzero exit code.
Forced process termination or operating-system failure cannot guarantee cleanup.

`ActivityAgent.run()` blocks the calling thread and creates no reporting thread.
The foreground tracker has one explicitly started, interruptible polling worker
which is stopped during the same cleanup as both input listeners. Create a new
agent instance for a fresh run after stopping an existing instance.

## Application usage durations

The foreground agent also starts `AppUsageTracker`, which reuses foreground
observations without creating an additional thread. Console summaries show
cumulative active seconds per process name. Only app names and numeric duration
totals are exposed; the tracker does not store a window/input timeline.

- `get_usage_summary()` returns seconds accumulated in the current interval.
- `get_usage_summary(cumulative=True)` returns lifetime totals across resets.
- `reset_interval()` atomically returns completed interval totals and clears that
  interval, retaining lifetime totals and splitting ongoing usage at the reset.
- `stop()` finalizes usage and unsubscribes without stopping dependencies it does
  not own. The foreground agent stops all dependencies during its normal cleanup.

All elapsed calculations use monotonic time. The shared activity state maintains
an aggregate active-time clock, so idle gaps remain excluded even if input resumes
between summary calls. The clock uses the configured `IDLE_THRESHOLD` for the
session; restart the agent to change that threshold. Unknown/inaccessible app
periods are not assigned to another app. Attribution follows observed foreground
changes and therefore has the same polling resolution as `ActiveWindowTracker`.

## Interval activity summaries

`ActivityCalculator` is started by the foreground agent and checked by its existing
reporting loop. It adds no worker thread. The interval uses `TRACKING_INTERVAL`
(default 60 seconds). JSON-compatible summaries contain interval counts, actual
elapsed seconds, active/idle seconds, current status, score calibration, per-app
interval duration deltas and separate lifetime application-duration totals.

The activity score describes **input event intensity only**. It is not a measure
of productivity, employee performance, work quality or effort. Device event rates,
OS auto-repeat and non-input work affect the observed values.

For each signal, calculate:

```text
component = min(1, (interval_count / elapsed_seconds * 60) / reference_per_minute)
score = 100 * sum(weight * component) / sum(weights)
```

Scores are clamped to 0–100 and rounded to two decimal places. Full elapsed time,
including idle time, is used for rates. Zero-duration intervals produce a zero
score. No input does not immediately mean idle: active/idle duration still follows
the configured inactivity threshold.

| Signal | Weight environment variable (default) | Reference environment variable (default per minute) |
| --- | --- | --- |
| Mouse movements | `ACTIVITY_MOVEMENT_WEIGHT` (0.2) | `ACTIVITY_MOVEMENTS_PER_MINUTE` (120) |
| Mouse clicks | `ACTIVITY_CLICK_WEIGHT` (0.3) | `ACTIVITY_CLICKS_PER_MINUTE` (30) |
| Anonymous key presses | `ACTIVITY_KEY_WEIGHT` (0.5) | `ACTIVITY_KEYS_PER_MINUTE` (120) |

Weights must be finite and nonnegative with a positive sum. References must be
finite and positive. These are calibration defaults, not activity targets.
Set environment overrides before launching the agent.

For standalone use, construct the calculator with the input trackers, shared idle
detector and optional app-usage tracker, then call `start()` and
`calculate_summary()`. It returns `None` until due. `force=True` flushes a partial
interval; `stop()` flushes and ends the calculator without stopping dependencies.
Delayed calls summarize actual elapsed time rather than fabricating fixed bins.

A successfully built, JSON-valid summary commits new interval counter cursors.
The next interval therefore starts from zero while cumulative input counters and
application usage remain intact. Failed summary creation does not commit those
cursors. Do not externally reset raw input counters while a calculator session is
running; construct/start a fresh calculator session after such a reset. Summary
creation is not an upload acknowledgment; reliable transport is not implemented.

## Explicit offline activity queue (Windows)

`core/offline_queue.py` provides `OfflineQueue`, an opt-in SQLite queue. Importing
it creates no files. The foreground agent is not silently switched to persistence;
an integration caller must supply the authenticated employee ID, timezone-aware
interval boundaries and an aggregate summary. No employee identity or API endpoint
contract is invented, and this module never makes network requests.

```python
from agent.core.offline_queue import OfflineQueue

# employee_id and UTC boundaries come from the caller, not embedded credentials.
with OfflineQueue() as queue:
    record_id = queue.enqueue(employee_id, interval_start, interval_end, summary)
    pending_records = queue.retrieve_pending(limit=100)
    # Send each record with its record_id as the backend idempotency key.
    # Only after the backend confirms particular IDs:
    queue.mark_synchronized(confirmed_record_ids)
    queue.delete_synchronized(confirmed_record_ids)
```

`retrieve_pending()` does not acknowledge, lease or delete records. Failed uploads
require no queue changes, so the same pending IDs survive retries and restarts.
Use one upload worker; permanent retry deduplication also requires the backend to
enforce uniqueness of `record_id`. Default IDs are deterministic UUIDs for an
employee/normalized interval. If an explicit UUID is supplied, callers must reuse
that UUID on retry. Conflicting payloads for an existing interval/ID are rejected.
Acknowledged-payload deletion retains bounded, expiring metadata receipts to
suppress local re-enqueues. A receipt holds only IDs/hashes/acknowledgment time.

Record payloads include employee ID, UTC interval start/end, anonymous aggregate
counts, active/idle durations, optional activity-intensity score/status and
interval app-name/duration totals. The schema rejects unknown content/credential
fields and individual-key fields. Cumulative app totals and score calibration
metadata in calculator summaries are not persisted, avoiding unnecessary copies.
The calculator's monotonic elapsed duration remains authoritative; UTC boundaries
are supplied separately and need not be inferred from monotonic clock values.

### Windows protection

- The dedicated queue directory has a protected DACL granting access only to the
  current Windows user and SYSTEM. Database ACLs are restricted as well; SQLite
  journals inherit directory protection. Existing non-private directories are
  rejected without rewriting their permissions. No parent ACLs are changed.
- Entire employee/activity payloads are encrypted with current-user Windows DPAPI
  before insertion. SQLite metadata contains UUIDs, hashes, retention timestamps
  and synchronization state, not plaintext employee IDs or application names.
- There is no plaintext fallback when permissions, DPAPI or decryption fail.
  Passwords, tokens, raw keys, titles, URLs, document content and screenshots are
  never accepted as stored record fields. No custom encryption keys are saved.
- DPAPI and ACLs are Windows account protections, not defenses against a process
  already controlling the same account or a fully compromised administrator.
  Decryption requires the appropriate Windows profile/DPAPI keys; do not assume
  the database is portable to another account or machine.

### Bounds and failures

| Environment variable | Default |
| --- | --- |
| `OFFLINE_QUEUE_PATH` | `%LOCALAPPDATA%/WorkPulse/queue/activity.sqlite3` |
| `OFFLINE_QUEUE_RETENTION_DAYS` | 7 |
| `OFFLINE_QUEUE_MAX_RECORDS` | 10,000 queued payloads |
| `OFFLINE_QUEUE_MAX_BYTES` | 64 MiB of encrypted payloads |
| `OFFLINE_QUEUE_MAX_RECORD_BYTES` | 64 KiB of canonical aggregate content |
| `OFFLINE_QUEUE_DB_TIMEOUT` | 5 seconds |

The path's parent must be a dedicated queue directory, not an existing shared
project or user directory. If `LOCALAPPDATA` is absent, set an explicit local path.
Network paths, symlinks and junctions at queue storage locations are rejected.
Record limits and byte limits reject new data via `QueueFullError`; pending
records are not silently evicted. Keep the summary/ID available for retry if an
enqueue fails. Aggregate data still expires under the explicit retention policy,
even when unsynchronized. Retention is enforced on open and queue operations;
`prune_expired()` allows explicit maintenance, without a hidden maintenance thread.
Expiry is based on interval end (bounded by insertion time for future intervals).

Sync receipts are bounded separately to at most `OFFLINE_QUEUE_MAX_RECORDS` and
expire after the same retention duration. The byte limit measures encrypted
payloads, not SQLite page/index overhead or the file's allocated high-water size.
SQLite transactions, parameterized values and serialized access protect concurrent
operations. Busy/corrupt databases and encryption failures raise sanitized queue
errors rather than clearing/replacing the database or logging record contents.

## Authentication integration status

The checked-out `backend` has package files but no implemented routes,
controllers, JWT middleware or API response contract. The frontend login also
explicitly reports that backend authentication is unavailable. No login URL,
JWT algorithm/issuer/audience/key source, refresh flow or logout URL is assumed.
The agent is therefore **not yet authenticated or gated by a backend session**.
Do not treat the support components below as completed backend authentication.

- `ui/login.py` provides a masked email/password form. Without a real controller,
  the form disables credential entry and submission. It never starts tracking.
  A future adapter must perform the real HTTP request and verified authentication
  before closing/replacing the form. Error categories are sanitized; raw backend
  exceptions and response bodies are never shown or printed by the view.
- `auth/token_store.py` stores an already-verified access token and authoritative
  expiry in current-user Windows Credential Manager, scoped to the backend URL.
  It stores no passwords, employee profile, refresh token or plaintext file.
  Cached entries are not authentication proof, and no JWT claims are trusted or
  decoded by the cache. Signature/session verification requires the real backend
  contract. Expired/malformed entries are removed; local clear is idempotent.
- Credential Manager capacity errors fail closed without a file fallback. Token
  bytes are omitted from object representations and native errors are sanitized.
  As with DPAPI, a process controlling the same Windows account remains within
  the account's trust boundary.

Preview the disabled form with `python -m agent.ui.login` from the repository
root. To complete actual authentication, provide the implemented backend source
or API specification covering login payload/response, JWT verification or session
validation and logout/revocation. No new JWT library or guessed endpoint is added.

Authentication support tests use fabricated values. One integration test writes,
reads and deletes a synthetic Credential Manager entry under a fresh unique test
namespace; no existing credential targets are enumerated or read.

Run the synthetic test suite without recording real input:

```powershell
.\agent\venv\Scripts\python.exe -B -m unittest discover -s agent/tests -p "test_*.py" -v
```
# Visible system tray

Install `agent/requirements.txt`, then run `python -m agent.ui.tray` from the
repository root. WorkPulse starts **Tracking PAUSED**; right-click the W icon
to start local tracking, pause, view status, open the dashboard, logout locally,
or exit. The green badge and **Tracking ON** tooltip indicate confirmed running
listeners; the amber badge accompanies paused/transition/error text. Windows
may place icons in the overflow area; pin WorkPulse in taskbar tray settings.
The existing foreground console remains visible. Windows auto-start is optional
and is never enabled automatically; see the startup section below.

Set `DASHBOARD_URL` to the actual web dashboard URL. No frontend route is guessed.
Lifecycle commands execute on a worker, separate from the tray and input callbacks.
Pause stops the listeners; starting again creates a fresh in-memory tracking
session, so previous console session totals are not carried forward.

This is explicitly local mode, not authenticated employee deployment. Logout
stops tracking and removes the server-scoped cached token; server revocation
cannot run until the real backend authentication contract is supplied. No data
is uploaded. Sync initially says unavailable and last successful sync is Never.
A future sender can call `tray.state.update_sync(offline=True)` after network
failure, and pass an aware `acknowledged_at` datetime only after server success.
The tray does not invent connection status or synchronization timestamps.

# Transparent working-hours controls

Working-hours settings live in `config/config.py`. Defaults are Monday–Friday,
09:00–17:30 in **Asia/Colombo**. Configure before launching, for example:

```powershell
$env:WORKING_TIMEZONE = 'Asia/Colombo'
$env:WORKING_START = '09:00'
$env:WORKING_END = '17:30'
$env:WORKING_DAYS = '0,1,2,3,4'
.\agent\venv\Scripts\python.exe -m agent.ui.tray
```

Days use Monday=0 through Sunday=6. Times use 24-hour `HH:MM`; start is included,
end is excluded. Overnight shifts (e.g. 22:00–06:00) belong to the day they start.
Equal start/end is rejected, rather than silently enabling all-day tracking.
Invalid settings or an unavailable IANA timezone prevent startup. Install the
requirements, including `tzdata` on Windows. No backend policy endpoint is assumed.

The tray always starts paused. An explicit **Start / restart local tracking**
during allowed hours enables the current session and its scheduled resumption.
At closing time, listeners stop and status says **Tracking PAUSED: outside working
hours**. If the tray remains open, an automatically paused session resumes at the
next allowed window with a visible **Tracking ON** notification. Start outside
hours is rejected and does not arm a future automatic start.

**Pause**, **EMERGENCY STOP**, **Logout**, and **Exit** cancel scheduled resumption.
Only another explicit Start can enable it again; relaunching also starts paused.
An emergency stop request immediately vetoes input collection and queued starts;
cleanup runs on the worker so the tray menu remains responsive. A listener failure
also disables automatic resumption. Windows may put the icon in its overflow
area; pin WorkPulse to keep its status visible. The console remains visible too.

The console entry point (`python -m agent.core.agent`) applies the same policy,
prints the schedule/status, and stops its session when hours close; it does not
automatically restart. Ctrl+C is its always-available emergency stop. Starting
that command again is an explicit restart. Tray pause/resume creates a fresh
in-memory agent session and does not combine previous session totals.

Input events check the policy before updating counters or the activity timestamp.
Foreground sampling checks it before querying and publishing process names.
The agent checks for closure every 250 ms, independently of the reporting interval;
the tray refreshes within 500 ms. Once paused, all listeners have been stopped;
paused time is not carried into the next session's durations or counters.
Cleanup failures are reported instead of claiming a confirmed pause.

The configured IANA policy zone is explicit and independent of the Windows display
timezone. UTC instants are converted for each decision, including daylight-saving
offset changes. During a repeated hour both occurrences follow the same local
wall-clock schedule; nonexistent spring-forward times are skipped. A shift's real
elapsed length can therefore differ on DST days. Stop and relaunch with updated
configuration to change the policy/timezone; this requires an explicit restart
and cannot covertly resume a manually stopped session.

# Optional Windows sign-in startup (Windows 10 / 11)

Right-click the visible WorkPulse tray icon and choose:

- **Enable Windows auto-start (opens paused)** to opt in for the current user.
- **Disable / remove Windows startup entry** to opt out and delete the entry.
- **Refresh Windows startup status** to read the current registration.

Only this clearly named registry value is managed:

```text
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
Value: WorkPulse Agent
Type: REG_SZ
```

There are no machine-wide entries, scheduled tasks, hidden names, administrator
prompts, startup-approval overrides, or automatic re-registration. A missing entry
is disabled, and removal is idempotent. Registry access errors are shown in the
tray without changing tracking state. Other applications' entries are untouched.
An unexpected existing value under the same name is not overwritten: explicitly
remove it first. Disable/remove remains available even if the executable moved.

The startup command uses the actual running executable (`sys.executable`) in a
packaged installation. Build a Windows executable with `agent/start_agent.py` as
its entry point; no packaged binary or installer is supplied in this repository.
For source installations, registration uses the current visible `python.exe`,
`-I`, and the absolute `agent/start_agent.py` path. This resolves imports without
depending on the Windows logon working directory or `PYTHONPATH`. Paths with spaces
are quoted using Windows command-line rules. Missing executable/launcher files,
windowless source interpreters and commands exceeding the Windows Run-key limit
are rejected before any registry write. Re-register explicitly after relocating
the installation; uninstallers should remove the named current-user value.

Launches at sign-in always open the visible tray **Tracking PAUSED**, display a
notification, and leave scheduled tracking disabled until the employee explicitly
chooses Start. `--startup` identifies the launch origin only: it does not restore
tracking consent, authenticate, upload, or start listeners. Working-hours checks
still apply to Start. The existing backend authorization integration remains
unavailable; auto-start does not grant authorization or enable a production
employee session. Emergency Stop and manual-stop behavior are unchanged.

WorkPulse reports whether its expected entry is **registered**, rather than
claiming Windows will execute it. Windows Settings / Task Manager, organization
policy, and sign-in delays can independently prevent or delay startup. Windows
may also place the tray icon in the overflow area; pin it to keep status visible.
Settings supplied only to an interactive PowerShell session are not inherited at
the next Windows sign-in: use centralized defaults or persistent current-user
environment configuration for the intended schedule, timezone and dashboard URL.

Startup tests mock all registry calls and never create a real Run entry. Installing,
running tests, importing the module, and ordinary application launches do not opt
the employee into startup. This implementation has not enabled auto-start for you.
