# WorkPulse Agent 1.0.0 release installer

The new `WorkPulseAgent.iss` is the release entry point. Existing application
source, the legacy `WorkPulseAgent.spec`, the working packaging specs and
`installer/WorkPulseAgent.iss` were preserved.

Verified input is `dist/onedir/WorkPulseAgent/WorkPulseAgent.exe` with its complete
`_internal` runtime folder. Product/Agent version is 1.0.0 and publisher display
is WorkPulse (provisional). That bundle opens the visible tray PAUSED and passed
native dependency smoke checks. The separate legacy `dist/WorkPulseAgent.exe`
targets `core/agent.py` with no console and is deliberately not used.

## Compile with your installed Inno Setup 7

From `C:\Users\DELL\Documents\GitHub\WorkPulse`:

```powershell
.\agent\venv\Scripts\python.exe -B agent/installer/build_release.py
# Or directly, from any working directory:
& "$env:LOCALAPPDATA\Programs\Inno Setup 7\ISCC.exe" "C:\Users\DELL\Documents\GitHub\WorkPulse\agent\WorkPulseAgent.iss"
```

The Python helper validates existing executable metadata/runtime inputs and
writes a checksum and build report. It does not rebuild or overwrite application
source. If the selected bundle is missing, use the established console-enabled
`packaging/WorkPulseAgent-onedir.spec` build and smoke-check instructions before
compilation; do not substitute the older tracking CLI executable.

Output: `agent/release/WorkPulseAgentSetup.exe`.
Compile diagnostics: `agent/build/release-compile.log`.
Checksum and result metadata are stored alongside the release installer.

The installer includes only the runtime executable/folder, privacy notice and
employee user guide. It includes Start Menu/uninstall shortcuts and an unchecked
desktop-shortcut task. Startup and post-install launch remain optional/unchecked.
No venv, project development tree, build guides, employee queues/logs, deployment
credentials or `.env` files are added. Normal installation defaults to native
Program Files and requires administrator authorization. The app starts PAUSED;
installation is not employee tracking consent or backend authorization.

Uninstall retains employee activity data, logs, credentials and custom settings.
There is no data-deletion task. The app's backend authentication/synchronization
is not connected in this release; the installed privacy/user notice states this.

## Verification

```powershell
.\agent\venv\Scripts\python.exe -B agent/installer/verify_release.py
```

This uses a unique per-user test directory and Start Menu group, not the elevated
Program Files path. Desktop creation is tested only if no employee desktop
shortcut already exists, and the test shortcut is uninstalled afterward. No
startup task is selected during this test. Synthetic data is retained through
uninstall. Existing current-user installations are preserved rather than used as
test targets. See `release/verification.json` for actual results.

Windows 10 and 11 x64 are installer targets. Only actually executed host tests
count as acceptance; Windows 10, clean-machine, elevated installation, complete
wizard UX and production authorization still need separate verification.
No signing certificate or verified publisher identity is configured. The locally
installed Inno Setup 7.1.1 compiler reports "Non-commercial use only"; commercial
compiler licensing has not been verified/configured. No purchase or signing was
performed. Do not bypass Windows security or organization policies to run it.
