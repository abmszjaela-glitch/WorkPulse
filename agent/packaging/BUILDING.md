# Windows executable builds

## Entry-point and dependency audit

| Entry point | Role | Distribution decision |
|---|---|---|
| `agent/start_agent.py` | Visible PAUSED tray launcher; `--startup` and explicit `--smoke-test` | **Main PyInstaller entry point** |
| `python -m agent.ui.tray` | Direct development tray launch | Reached through main launcher |
| `python -m agent.core.agent` | Foreground count-reporting CLI; immediately requests a policy-allowed session | Not the packaged entry point |
| `python -m agent.ui.login` | Disabled login preview awaiting actual backend contract | Include UI dependencies, not a separate executable |
| `agent.performance_test`, `agent.compatibility_test` | Developer/test harnesses | Excluded from runtime bundle |

The application configuration is `agent/config/config.py`, imported and compiled
into the archive. Configuration is overridden through documented environment
variables; the application does not load a deployment `.env` file. Do not add the
backend `.env`, test credentials, queue databases or developer configuration to
the bundle. No secrets are needed to build. The existing tray W graphic is drawn
in code by Pillow; no external logo/image is required by the agent.

The shared spec helper supplies an explicit entry point and import search path,
Windows dynamic backend imports for pynput and pystray, psutil's native extension,
pywin32 APIs for windows/processes/credentials/DPAPI/ACLs, and the login/offline
queue modules which are not reached by the current main UI. Standard PyInstaller
and contributed hooks collect the Python DLL, dependent DLLs, Tcl/Tk data/DLLs,
Pillow plugins, and pywintypes runtime hook. Explicit package data is limited to
IANA `tzdata` and certifi's public CA bundle. No whole-project/venv add-data or
collect-all is used. Dependencies are taken from the build venv, but the venv
directory, `pyvenv.cfg`, activation scripts and development workspace are not
copied into the executable. Unused Socket.IO dependencies are not force-bundled.

Two specs use exactly the same input helper:

- `WorkPulseAgent-onedir.spec`: console-enabled one-folder debug distribution.
- `WorkPulseAgent-onefile.spec`: console-enabled one-file distribution, built
  only after onedir validation.

These are repeatable inputs, not a promise of bit-identical binaries across
different interpreters, dependency versions, paths, timestamps or machines.
Use the pinned project requirements and record toolchain versions/build host.
Build Windows binaries on Windows; this test used x64 Python 3.15.2,
PyInstaller 6.22.3 and hooks-contrib 2026.10. Other toolchains require testing.

## Build and test (PowerShell, repository root)

Install the locked requirements into a dedicated build venv if desired. Existing
`agent/venv` is used below; do not overwrite an existing environment accidentally.

```powershell
py -3.15 -m venv agent\venv-build
.\agent\venv-build\Scripts\python.exe -m pip install -r agent\requirements.txt
.\agent\venv-build\Scripts\python.exe -m pip check
```

For that environment substitute `venv-build` for `venv` in the commands below.
Keep the architecture and interpreter consistent across build/test machines.

```powershell
# 1. Source regression checks.
.\agent\venv\Scripts\python.exe -B -m unittest discover -s agent/tests -p 'test_*.py'

# 2. One-folder first. This creates agent/dist/onedir/WorkPulseAgent/.
.\agent\venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath agent/dist/onedir --workpath agent/build/onedir agent/packaging/WorkPulseAgent-onedir.spec

# 3. Test a copy relocated to a path with spaces and an unrelated CWD.
.\agent\venv\Scripts\python.exe -B agent/packaging/verify_build.py onedir

# 4. Continue ONLY after onedir tests pass.
.\agent\venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath agent/dist/onefile --workpath agent/build/onefile agent/packaging/WorkPulseAgent-onefile.spec
.\agent\venv\Scripts\python.exe -B agent/packaging/verify_build.py onefile
```

`--noconfirm` replaces only selected generated output directories; do not point
dist/work paths at source directories. Source files are preserved. Avoid broad
manual cleanup commands. `agent/build` and `agent/dist` are ignored by Git.

For a regular visible launch, run `agent/dist/onedir/WorkPulseAgent/WorkPulseAgent.exe`
or `agent/dist/onefile/WorkPulseAgent.exe`. Both start **Tracking PAUSED**; explicit
Start and existing policy checks remain required. `--startup` does not grant
authentication/authorization or start listeners. The startup registration uses
the actual installed `sys.executable`, never the one-file extraction directory.

## Smoke scope and evidence

`verify_build.py` copies the distribution to a temporary directory owned by the
test, strips Python/Tcl path environment overrides, changes working directory,
and executes `--help` and `--smoke-test`. Smoke mode loads native modules, checks
timezone/CA data, SQLite in memory, synthetic DPAPI encryption/decryption and a
native Tk initialization, then shows a real PAUSED tray and exits after three
seconds. It checks lifecycle logging and that no queue/tracking session started.
It does not start input listeners, authenticate, upload, read existing credentials
or write startup entries. The tray may read only its own startup registration.

Per-format reports are `agent/reports/packaging-onedir-results.json` and
`packaging-onefile-results.json`, with timestamps, SHA-256 hashes, executable
sizes, Windows build and per-check PASS/FAIL. Keep them with the build inputs.
The verifier's temporary relocated copies and log files are removed afterward.

The smoke reports do not replace native input/long-soak/backend/clean-VM tests.
Windows 10 is NOT TESTED unless executed on Windows 10. This checkout's backend
authentication and synchronization are still unavailable; packaging does not
make the agent production-authorized. Follow WINDOWS_COMPATIBILITY_TEST_PLAN.md
on clean standard-user Windows 10 and 11 systems without a Python installation.

## Debugging and release cautions

- **Console remains enabled in both specs.** Do not add `--noconsole`: the visible
  tray and operational logger exist, but pre-import/configuration/bootloader errors
  are not all captured by the privacy-restricted event logger. Console diagnostics
  are required. A future windowless release needs an explicit safe early-error UI
  and logging design, plus failure-injection tests.
- Review `agent/build/<mode>/<spec-name>/warn-<spec-name>.txt` and the graph xref.
  Optional Unix/macOS/X11/evdev imports are not Windows runtime dependencies; do
  not install them merely to silence warnings. Required Windows import failures
  must be fixed and the executable retested. The recorded smoke validates the
  required current Windows paths; it does not certify every optional code path.
- Distribute the **entire onedir WorkPulseAgent folder**, including `_internal`.
  Copying just its EXE breaks that distribution. The one-file EXE is standalone
  but extracts dependencies into a temporary location at launch; never store logs,
  settings, queues or credentials in that extraction tree. Normal persistence uses
  per-user AppData/Credential Manager; configure explicit writable paths if needed.
- The initial Agent version and publisher display are now supplied centrally by
  `agent/version.py`; the Inno Setup installer is documented in `installer/README.md`.
  No signing certificate or verified legal publisher identity is configured.
  Sign and validate through your authorized release process; test endpoint security,
  SmartScreen, clean-machine prerequisites, upgrades, uninstall/startup removal,
  one-file extraction cleanup and enterprise policy before distribution. Do not
  disable antivirus or elevate simply to make packaging tests pass.

PyInstaller reference: https://pyinstaller.org/en/stable/spec-files.html
