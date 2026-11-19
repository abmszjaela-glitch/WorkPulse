# WorkPulse Agent Windows compatibility execution report

Execution UTC: 2026-11-19T10:37:50.416907+00:00

Host: **Windows 11**, build **26200**, AMD64; Python **3.15.2**.

This records executed evidence, not blanket Windows compatibility certification.

PASS = stated check executed successfully. FAIL = executed check failed. NOT TESTED = skipped, unavailable or not executed.

## Platform coverage

| Platform | Automated run | Full release acceptance |
|---|---|---|
| Windows 10 | NOT TESTED | NOT TESTED |
| Windows 11 | PASS | NOT TESTED |

## Executed checks and gaps

| Check | Result | Evidence / scope |
|---|---|---|
| Installed required packages | PASS | Metadata for the required agent packages; does not replace clean installation testing |
| Python dependency consistency | PASS | Executed python -m pip check in the current environment |
| Automated suite | PASS | 168 unittest cases executed; detailed scope and outcomes below |
| Native tray create / paused launch / exit | PASS | Real Windows event loop only when explicitly requested; no tracking listeners started |
| Controlled CPU/RSS/listener lifecycle benchmark | PASS | Only a fresh benchmark from this invocation counts; real backend synchronization remains unmeasured |
| Clean Python installation | NOT TESTED | Existing venv tested; clean VM setup not executed |
| Physical mouse/keyboard counters | NOT TESTED | Unit tests use fabricated callback events; actual hardware/lock-screen cases not executed |
| Real foreground application switches | NOT TESTED | Unit tests mock window/process calls; native benchmark substitutes a fixed app name |
| Real application usage and idle transitions | NOT TESTED | Controlled unit tests pass/fail separately; physical cross-app timing requires manual execution |
| Backend employee login and verified JWT | NOT TESTED | Backend auth endpoints/verification contract are absent; UI/cache tests are support only |
| Backend synchronization/retries/idempotency | NOT TESTED | Sender/upload contract unavailable; no successful upload claimed |
| Complete tray UX and emergency control | NOT TESTED | Native smoke is limited; manual menu, Explorer restart and visibility checks not executed |
| Actual startup Run registration and reboot | NOT TESTED | Registry writes mocked; no real startup entry enabled |
| Packaged executable installation | NOT TESTED | No packaged installer/executable supplied |
| Sleep/resume/Explorer/network fault recovery | NOT TESTED | Unit error paths tested separately; real OS transitions not executed |
| Long-duration memory/thread soak | NOT TESTED | Short controlled cycles cannot prove leak absence |

## Automated module results

| Test module | Result | PASS | FAIL | NOT TESTED |
|---|---|---:|---:|---:|
| test_active_window_tracker | PASS | 13 | 0 | 0 |
| test_activity_calculator | PASS | 16 | 0 | 0 |
| test_agent | PASS | 18 | 0 | 0 |
| test_app_usage_tracker | PASS | 15 | 0 | 0 |
| test_compatibility_report | PASS | 3 | 0 | 0 |
| test_idle_detector | PASS | 8 | 0 | 0 |
| test_keyboard_tracker | PASS | 10 | 0 | 0 |
| test_logger | PASS | 7 | 0 | 0 |
| test_login_ui | PASS | 5 | 0 | 0 |
| test_mouse_tracker | PASS | 9 | 0 | 0 |
| test_offline_queue | PASS | 25 | 0 | 0 |
| test_performance | PASS | 5 | 0 | 0 |
| test_token_store | PASS | 8 | 0 | 0 |
| test_tray | PASS | 10 | 0 | 0 |
| test_windows_startup | PASS | 9 | 0 | 0 |
| test_working_hours | PASS | 7 | 0 | 0 |

unittest testsRun: **168**. Per-test evidence is in the JSON; subtest failures can produce additional evidence rows.

## Interpretation

Mouse/keyboard/foreground/counter/idle/usage/agent orchestration unit tests use controlled input and mocks. They do not prove physical input capture or cross-application behavior.
Queue tests execute real temporary SQLite, Windows DPAPI and ACL operations with synthetic records. Credential storage includes a real synthetic Windows Credential Manager round trip. They do not prove backend authentication.
Startup registry modifications are mocked. Native startup enable/disable, real sign-out/reboot, security-product interactions, tray menu UX and clean-machine installation require the manual plan.
Backend authentication and synchronization are unavailable in this checkout. Their end-to-end results are NOT TESTED, even though supporting UI/cache/queue tests pass.
Native tray smoke covers icon/event-loop creation, paused startup and exit only; it does not verify every menu/notification or Explorer restart.
Performance results cover short controlled native-listener workloads with discarded OS input, synthetic counters and fixed foreground app. No unrelated employee process is inspected. See performance-report.md for metrics and limits.
Only the current OS build, architecture and interpreter were executed. Other Windows/Python/build combinations remain NOT TESTED.

Full acceptance remains **NOT TESTED** until the plan's integration/manual matrix is executed on both target OS versions.
