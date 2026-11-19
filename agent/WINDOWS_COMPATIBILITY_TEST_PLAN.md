# WorkPulse Agent Windows compatibility test plan

## Purpose and evidence rules

Validate the agent on **real Windows 10 and Windows 11 installations or VMs**.
An operating-system name in a CI job, mocked API, successful import, or another
machine's results is not execution evidence for that Windows version. Record
edition, actual build, workstation/server type, architecture, Python version,
dependency versions, source revision and test timestamp for every run. Do not
include hostnames, usernames, real employee identities, credentials or tokens.

Use these result values for every executed case and platform cell:

- **PASS**: the stated scope ran and every acceptance criterion was met.
- **FAIL**: execution ran but a criterion failed, setup failed or execution errored.
- **NOT TESTED**: not executed, skipped, interrupted before sufficient evidence,
  missing implementation, unavailable environment or unmet prerequisite.

A unit PASS establishes only the controlled assertion stated in that test.
It does not imply native hardware, authentication, networking or whole-platform
acceptance. An unavailable feature is NOT TESTED, not a successful negative test.
If a feature is implemented and then fails its stated requirement, record FAIL.
Keep a defect reference, sanitized steps, expected/actual result, build and retest
result for every FAIL. Keep the blocking dependency for every NOT TESTED.

## Execution matrix

Execute each applicable case on both workstation OS families. Record exact builds
instead of claiming all releases of a family have passed.

| Dimension | Required coverage | Initial status |
|---|---|---|
| Windows 10 | x64 standard-user clean VM, exact edition/build recorded | NOT TESTED until executed there |
| Windows 11 | x64 standard-user clean VM, exact edition/build recorded | NOT TESTED until executed there |
| Python | Current project interpreter plus each proposed supported Python version in a fresh venv | Every unexecuted version NOT TESTED |
| Distribution | Source checkout; installed executable when one is supplied | Packaged build NOT TESTED until available |
| Accounts | Standard user; denied-access scenario; separate Windows user for isolation | NOT TESTED until executed |
| Sessions | Local desktop, locked/unlocked, sleep/resume, sign-out/sign-in; RDP if supported | NOT TESTED until executed |
| Display | Single/multiple monitors; 100%, 150%, 200% scaling; tray overflow | NOT TESTED until executed |
| Network | Online, offline, DNS failure, timeout, reconnect, TLS failure, throttled server | NOT TESTED until authorized test API exists |
| Schedule | Weekdays/weekends, midnight, overnight shift, explicit policy zone, DST changes | Unit evidence and native scenario results recorded separately |

Candidate Python versions are a test matrix, not an assertion that pinned wheels
support them. Installation failures are actual FAIL results for that candidate.
Use a disposable VM for clock, disk-full, permission, reboot and security-product
tests. Do not change an employee's live clock, registry, network or security settings.

## Prerequisites and safe setup

1. Use a dedicated Windows test account and nonproduction registered employee.
   Obtain authorization for the test backend and policy; use synthetic data only.
2. Check out the same revision on each VM. Record `git rev-parse HEAD` separately
   from local uncommitted changes; a revision alone does not identify dirty source.
3. Install the Python candidate from an approved distribution. Open PowerShell in
   the repository root. Create a clean environment, without overwriting an existing
   employee environment:

   ```powershell
   py -3.15 -m venv agent\venv-compat
   .\agent\venv-compat\Scripts\python.exe -m pip install -r agent\requirements.txt
   .\agent\venv-compat\Scripts\python.exe -m pip check
   .\agent\venv-compat\Scripts\python.exe -B -m agent.compatibility_test --native-tray-smoke --performance --output agent\reports
   ```

   Substitute the chosen interpreter; 3.15 is the current test candidate, not a
   requirement for every deployment. Activate only if desired; activation-policy
   changes are not required when invoking the venv executable directly.
4. The automated runner uses fabricated input, temporary queues and a unique
   synthetic Credential Manager test entry which it deletes. Native tray smoke
   displays a real icon PAUSED for three seconds and exits. Performance listeners
   discard OS input and use fabricated count events; no foreground employee
   processes are inspected. Startup registry writes remain mocked.
5. Set `WORKING_TIMEZONE`, `WORKING_START`, `WORKING_END`, `WORKING_DAYS`, and
   `DASHBOARD_URL` explicitly for manual tests; check the visible policy before
   Start. Startup should inherit persistent user configuration, not just a
   temporary PowerShell environment. All launches must initially be paused.
6. Before backend cases, supply the actual implemented endpoints, schemas, token
   verification rules, employee authorization rules, acknowledgement format and
   idempotency contract. This checkout does not have those implementations. Never
   invent URLs or bypass authorization to make a case pass.

## Detailed cases

Each row must be recorded separately for Windows 10 and Windows 11. Unless the
generated execution report explicitly records a narrower automated scope, these
native/integration acceptance cases start **NOT TESTED**.

### Environment and installation

| ID | Execution / steps | Acceptance criteria |
|---|---|---|
| ENV-01 | Create fresh venv; install requirements; run pip check; import native dependencies | No unresolved dependencies; correct architecture; no administrator requirement for normal launch |
| ENV-02 | Repeat with each Python candidate and paths containing spaces/non-ASCII characters | Imports and launch succeed or record the exact failed version/path case; no presumed support |
| ENV-03 | Launch from a different working directory using absolute launcher paths | Imports resolve; visible tray and paused state; no unintended registry mutation |
| ENV-04 | Missing dependency, invalid schedule/timezone/log setting, missing interpreter | Clear failure; no hidden tracking or partial unauthorized startup; recovery after corrected configuration |
| ENV-05 | Install/uninstall packaged executable when supplied | Correct installed path; dependencies bundled; launch/uninstall works as standard user; no orphan startup entry |

### Mouse, keyboard, foreground applications and timing

| ID | Execution / steps | Acceptance criteria |
|---|---|---|
| INPUT-01 | In an explicitly started test session perform a known set of clicks and movement events | Counts increase; release is not double-counted; movement count is event count, not physical distance; no coordinates retained |
| INPUT-02 | Press a known number of keys; include held-key repeat and keyboard-layout/IME changes | Numeric press count only; auto-repeat behavior documented; no key names/codes/text retained in memory stores, logs or reports |
| INPUT-03 | Concurrent synthetic input and summary reads; rapid start/stop; post-stop callbacks | Thread-safe totals; no crashes/lost increments in controlled tests; post-stop events do not change counters or last_activity |
| APP-01 | Switch between approved test applications on a clean VM | Process names only; correct switch detection within configured poll interval; no titles, documents or URLs collected |
| APP-02 | Close app during lookup; foreground missing; inaccessible/elevated process | No crash, private data dump or tight retry loop; unavailable app handled safely |
| USAGE-01 | Use app A then B for measured periods, with repeated summary reads | Monotonic durations within polling/scheduling tolerance; no duplicate accumulation; only names/durations stored |
| USAGE-02 | Add idle periods, reset interval, then inspect cumulative usage | Idle excluded; interval reset preserves cumulative totals; no double-counted boundary |
| IDLE-01 | Use short configured threshold; wait below/at/above boundary | ACTIVE before threshold, IDLE at/after; each allowed mouse move/click/key press resets timer |
| IDLE-02 | Change wall clock in disposable VM while testing inactivity | Idle duration remains monotonic; no negative elapsed duration; schedule policy still follows its explicit timezone |
| POLICY-01 | End work window, weekend and overnight shift transitions | Input gate denies out-of-hours events; listeners stop; visible policy pause; paused periods not carried into new session totals |
| POLICY-02 | Manual pause/emergency stop/logout across closing and next opening | No automatic restart after manual stop; only explicit Start re-enables session; queued starts cannot override emergency stop |
| POLICY-03 | Spring-forward gap, repeated autumn hour, OS display-zone change, explicit policy update | Both repeated-hour occurrences follow documented local schedule; nonexistent times skipped; fixed policy zone independent of display zone; changes require transparent restart |

### SQLite offline queue and local security

| ID | Execution / steps | Acceptance criteria |
|---|---|---|
| QUEUE-01 | Enqueue synthetic aggregate, close/reopen SQLite, retrieve pending | Stable UUID, employee/interval/count/duration/app aggregate intact; pending survives process restart |
| QUEUE-02 | Exact retry; conflicting same ID/interval; repeated acknowledged ID | Exact retry deduplicates; conflicting data rejected; no overwrite; durable receipt behavior matches documented retention window |
| QUEUE-03 | Read DB/journal as bytes and inspect ACLs; attempt access as different test account | Aggregate payload encrypted using current-user DPAPI; private directory ACL; other account cannot decrypt/access; no plaintext token/password/key content |
| QUEUE-04 | Exhaust configured record/byte limits, expire records, prune receipts | Pending data not evicted for capacity; explicit retention behavior enforced; bounded storage; clear queue-full behavior |
| QUEUE-05 | Locked/read-only/corrupt DB, disk full, interrupted insert/ack transaction | Parameterized SQL, rollback, sanitized error; no unacknowledged record silently treated as synced; valid queue recovers safely |
| QUEUE-06 | Mark/delete only acknowledged IDs, then retry after process restart | Unacknowledged data retained; synchronized payload removal leaves applicable deduplication receipt |

### Employee authentication (blocked pending backend implementation)

| ID | Execution / steps | Acceptance criteria |
|---|---|---|
| AUTH-01 | Registered nonproduction employee valid login using real API contract | Backend authenticates; identity/role enforced; token cryptographically/session validated using actual contract before authenticated access |
| AUTH-02 | Invalid credentials, disabled employee, wrong role/employee, network failure | Clear sanitized feedback; no auth bypass, tracking permission escalation, token/credential logging or plaintext password persistence |
| AUTH-03 | Expired, tampered, wrong issuer/audience/algorithm tokens and clock skew | Rejected per real backend policy; no trusting decoded unverified claims; expired session cannot upload or become authenticated |
| AUTH-04 | Secure token save/load, missing/corrupt entry, logout, relaunch, changed backend URL | Proper current-user storage and expiry; scoped entries; local removal; server revocation when actual API exists; no password/refresh token plaintext |

UI/cache unit tests alone cannot mark AUTH-01/02/03 or server logout PASS.

### Backend synchronization and retries (blocked pending sender/API contract)

| ID | Execution / steps | Acceptance criteria |
|---|---|---|
| SYNC-01 | Upload pending synthetic batches at configured limit with authenticated employee JWT | Actual endpoint/schema reused; only aggregates sent; employee scope enforced; ack IDs match sent records |
| SYNC-02 | Server persists but response is lost; restart client and retry same UUIDs | Backend idempotency prevents duplicate persistence; same stable IDs reused; local queue only acknowledges server-confirmed records |
| SYNC-03 | Partial acknowledgement; malformed/unknown IDs; HTTP success without valid ack | Only valid explicitly acknowledged submitted IDs marked synced; all others remain pending; no blanket success on 2xx |
| SYNC-04 | Disconnect, DNS failure, TLS failure, timeout, reconnect | No insecure TLS fallback; pending retained; bounded exponential retry/backoff; connectivity restoration resumes without blocking listeners |
| SYNC-05 | 400/401/403/409/429/5xx responses under real contract | Auth expiration prompts re-auth; authorization never bypassed; retryability/idempotent conflict handling follows contract; Retry-After respected where supported |
| SYNC-06 | Logout/expiry while request in flight; queue from another test employee | No next upload with stale auth; no cross-employee records sent; in-flight acknowledgement handled according to documented session policy |
| SYNC-07 | Stop during retry sleep or upload; relaunch | Interruptible bounded shutdown; no busy waiting; record remains pending unless acknowledged; no credentials/raw data in logs |

### Tray, startup, logging, recovery and resources

| ID | Execution / steps | Acceptance criteria |
|---|---|---|
| TRAY-01 | Start app, inspect menu/tooltip/badge; start and pause | Initial PAUSED; ON only after listeners run; transitions notified; status matches actual state; employee can inspect it at any time |
| TRAY-02 | Trigger every menu action; dashboard URL unset/set; local logout | Responsive menu; no guessed dashboard URL; accurate local/server logout limitations; no sensitive feedback |
| TRAY-03 | Overflow pin, scaling, Explorer restart, notification suppression | Status remains discoverable; no false ON/PAUSED; document limitations rather than claiming notifications always display |
| TRAY-04 | Emergency Stop while starting, active, scheduled pause or retry | Always available; no new counts after veto; no secret restart; cleanup status truthful |
| START-01 | Explicit enable as standard user; inspect HKCU named value | Only visible WorkPulse Agent REG_SZ under Run; actual executable/source command correctly quoted; no HKLM, task, elevation or hidden entry |
| START-02 | Sign out/reboot and sign in with startup enabled | Visible app initially PAUSED; employee informed; no auto-authorized session/tracking; schedule policy not bypassed |
| START-03 | Disable/remove, sign in again; disable in Task Manager/Windows Settings | Named value removed when requested; app never silently recreates it or overrides Windows approval/organization policy |
| START-04 | Relocated/missing/long/space-containing executable path; denied registry access | Safe error; unknown existing command not overwritten; explicit removal works for stale path; no registry data leaked |
| LOG-01 | Trigger lifecycle/state/error/sync outcomes with synthetic secrets in rejected messages | Fixed safe event messages only; levels correct; no tokens/passwords/personal data/text/titles/tracebacks |
| LOG-02 | Small rotation limit, frequent repeated errors, full/read-only log directory | Bounded backups; repeated errors throttled; one sanitized logging warning; controls continue working |
| EXIT-01 | Ctrl+C/SIGTERM, tray Exit, listener callback error, startup failure | Every listener stop attempted; threads end; no callbacks after stop; no false cleanup confirmation; explicit restart after failure |
| EXIT-02 | Sleep/resume, lock/unlock, sign-out, abrupt termination and relaunch | No unauthorized restart or input capture while paused; queue durability verified; no duplicate uploads; current limitations reported honestly |
| PERF-01 | Run controlled paused/idle/active benchmark on both OSes | Actual average/peak CPU and RSS recorded; sample interval/count/rate shown; no unrelated process monitoring; threshold violations FAIL |
| PERF-02 | Measure real authorized upload/retry workload when available | CPU/RSS for sync recorded separately; real path distinguished from simulation; listener responsiveness preserved |
| PERF-03 | 1h and 8–24h controlled soak plus many start/stop cycles | Record retained Python/RSS trends, listener object/thread retention and polling rates; growth/leftovers investigated; no proof-of-no-leak claims from short tests |

## Automation coverage

Existing suites and the compatibility runner provide reusable automated evidence:

| Module(s) | Automated scope | Does not establish |
|---|---|---|
| test_mouse_tracker, test_keyboard_tracker | Anonymous counters, locking, callback failure and lifecycle using fake listeners | Physical hardware capture |
| test_active_window_tracker | Window/PID/name logic and safe failures using mocked APIs | Native foreground switching across applications |
| test_app_usage_tracker, test_activity_calculator, test_idle_detector | Controlled monotonic timing, interval/cumulative accounting, thresholds | Full-day real desktop timing |
| test_agent, test_working_hours | Orchestration, policy gating, shutdown with fake input; real timezone calculations | Sleep/logoff/clock change on each OS |
| test_offline_queue | Real temporary SQLite, DPAPI, ACLs with synthetic data; limits/errors/deduplication | Real authenticated upload or different-account manual verification |
| test_login_ui, test_token_store | Real Tk widget behavior; mocked and real synthetic Credential Manager cache checks | Backend login, JWT verification, server revocation |
| test_tray, test_windows_startup | Mocked native icon/registry; lifecycle and opt-in controls | Actual logon launch or all native menu UX |
| test_logger, test_performance | Rotation/privacy/failure paths; deterministic resource accounting and bounded sampler | Production diagnostics/long soak performance |
| test_compatibility_report | Status aggregation, skips, OS build classification | Running that OS merely by mocking its version |

`agent.compatibility_test` executes discovery, dependency checks, and opt-in native
tray/performance checks. JSON contains per-test PASS/FAIL/NOT TESTED; Markdown
summarizes module scope and explicit gaps. Manual cases require a separate case
record with ID, actual OS/build, Python, distribution, settings, observed result,
evidence timestamp and status. Do not alter automated artifacts to imply a manual
case ran; append clearly labeled manual execution evidence instead.

## Exit criteria and cleanup

- Both Windows 10 and Windows 11 have their required matrix executed, with actual
  build evidence; no OS-wide PASS from a single build or unit-only result.
- No unresolved FAIL in privacy, authorization, emergency stop, data integrity,
  duplicate prevention or required installation/shutdown cases.
- Backend integration remains release-blocking NOT TESTED until its implementation
  and authorized test environment exist. Packaged distribution also remains NOT
  TESTED until supplied and exercised.
- Actual CPU/RAM metrics meet agreed thresholds on each environment; review all
  growth/thread warnings. Short tests are not long-term leak certification.
- Remove only the synthetic test account's WorkPulse startup value if enabled;
  remove synthetic credentials/queues/test data and stop all listeners. Never
  enumerate or delete unrelated credentials/registry entries/processes.
- Archive the plan, JSON/Markdown reports, sanitized manual evidence, dependency
  versions, exact build/source state and defect/retest references together.
