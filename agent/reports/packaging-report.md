# WorkPulse Windows packaging execution report

Tested on Windows 11 x64, build 26200, with Python 3.15.2, PyInstaller 6.22.3
and hooks-contrib 2026.10. This is packaging smoke evidence, not production
release approval or full Windows compatibility certification.

| Artifact / check | Result | Evidence |
|---|---|---|
| Console-enabled one-folder build | PASS | agent/dist/onedir/WorkPulseAgent/WorkPulseAgent.exe |
| Relocated one-folder executable smoke | PASS | packaging-onedir-results.json, 2026-11-19 10:50:13 UTC |
| Console-enabled one-file build, after onedir success | PASS | agent/dist/onefile/WorkPulseAgent.exe |
| Relocated one-file executable smoke | PASS | packaging-onefile-results.json, 2026-11-19 10:52:39 UTC |
| Source regression suite | PASS | 169 tests; includes smoke-mode routing without starting normal tracking |
| Windows 10 execution | NOT TESTED | No Windows 10 host used |
| Clean Windows machine without Python installed | NOT TESTED | Current development host only |
| Physical input tracking and long soak in packaged executable | NOT TESTED | Smoke deliberately never starts input listeners |
| Backend authentication / synchronization | NOT TESTED | Actual backend contracts and implementations unavailable |
| Real startup registration and sign-in/reboot | NOT TESTED | Smoke checks executable command construction only; no registry writes |
| Code signing / installer / enterprise security acceptance | NOT TESTED | Unsigned build outputs; no installer supplied |

Both smoke runs copied the distribution to a path containing spaces, changed to
an unrelated working directory, and removed Python/Tcl path overrides. They
verified frozen execution, help CLI, Windows pynput/pystray/psutil imports,
pywin32 native APIs, SQLite, synthetic DPAPI, bundled timezone and CA data,
native Tk, logging, visible PAUSED tray startup and graceful exit. No tracking
session or offline queue was created. No credentials, backend data or startup
registrations were changed.

The specs bundle compiled config/application modules and explicitly approved
package resources. No project-tree/venv directory data is added. Test harnesses,
queues, logs, reports, `.env` files and development credentials are not packaged
as application data. Certifi's public `cacert.pem` is intentionally included;
private `.pem`/`.key` data is rejected by the manifest guard.

Both builds use `console=True`. Early boot/import/configuration errors do not
all reach the privacy-restricted file logger, so windowless mode was not enabled.
Required Windows paths passed; optional non-Windows imports still reported in
PyInstaller warning files are not treated as proof of missing Windows runtime
dependencies. Review warnings for future dependency changes and retest.

Distribute the entire onedir WorkPulseAgent folder, including `_internal`, or
the single onefile executable. Do not distribute only the onedir EXE. Exact
SHA-256 hashes, executable sizes and check results are recorded in the two JSON
files. Build commands and limitations are in `agent/packaging/BUILDING.md`.
