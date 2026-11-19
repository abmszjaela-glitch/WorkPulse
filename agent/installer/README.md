# WorkPulse Agent Windows installer

The installer packages the verified **one-folder PyInstaller distribution** from
`agent/dist/onedir/WorkPulseAgent`. It does not install from the source tree or a
venv. Default installation is the native x64 Program Files directory under
`WorkPulse Agent`, with normal Start Menu application, privacy and uninstall
shortcuts. Machine-wide Program Files installation requests administrator
authorization; the application itself does not require elevation.

## Release metadata and signing

Edit only `agent/version.py` for the Agent product name, three-part numeric
version, publisher display label and description. Current user-supplied values:

- Product: WorkPulse Agent
- Agent release: 1.0.0 (independent of backend package versions)
- Publisher display: WorkPulse
- Description: WorkPulse Employee Activity Tracking Agent

These constants feed the application tray/About UI, PyInstaller executable
resources and Inno Setup. `build_installer.py` rejects an application executable
whose resource metadata differs, rather than stamping a new installer around an
old app. Update the central file and rebuild before every release. Publisher is a
provisional display label, not a verified legal identity. No copyright owner,
website, signing identity or certificate was invented. The outputs are unsigned.

The downloaded official Inno Setup 6.7.4 compiler was Authenticode-verified before
installation. That third-party compiler signature does **not** sign WorkPulse.
The compiler currently reports **"Non-commercial use only"**. A commercial-use
compiler license was not supplied/configured; use an appropriately licensed
compiler for a commercial release. No license purchase was performed.

## Build (PowerShell, repository root)

Install the official Inno Setup compiler through your authorized tooling process.
The local build used `agent/build/tools/InnoSetup/ISCC.exe`; the compiler and
download are ignored build tools and are never redistributed with WorkPulse.

```powershell
# Rebuild after updating the centralized Agent version/publisher display.
.\agent\venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath agent/dist/onedir --workpath agent/build/onedir agent/packaging/WorkPulseAgent-onedir.spec
.\agent\venv\Scripts\python.exe -B agent/packaging/verify_build.py onedir

# Compile using the installed official compiler (omit --compiler for local default).
.\agent\venv\Scripts\python.exe -B agent/installer/build_installer.py --compiler 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'

# Optional: rebuild/test the standalone one-file artifact with matching metadata.
.\agent\venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath agent/dist/onefile --workpath agent/build/onefile agent/packaging/WorkPulseAgent-onefile.spec
.\agent\venv\Scripts\python.exe -B agent/packaging/verify_build.py onefile
```

Output: `agent/dist/installer/WorkPulseAgent-1.0.0-Setup-x64.exe` for this release.
The `.iss` script reads metadata only through the wrapper's explicit compile-time
arguments. Configuration is the compiled central module plus environment
overrides. Required DLLs, Tcl/Tk, tzdata, public certificates and application files
are inherited from the PyInstaller bundle. Installed documentation includes the
privacy notice and configuration/build guide. No backend `.env`, credentials,
queues, employee logs, venv directory, test data or private signing keys are added.

## Installation and privacy behavior

- The wizard displays `PRIVACY.txt` before installation and offers a Start Menu
  folder. The optional current-user startup task is **unchecked** and previous
  task choices are not silently restored.
- Startup uses the app's explicit `--enable-startup` command through Inno's
  `ExecAsOriginalUser`, not an elevated installer's HKCU. It writes only the
  visible WorkPulse Agent Run value. No service, scheduled task or system-wide
  startup value is created. Registration does not start tracking.
- Launch Setup normally and approve the ordinary elevation prompt if installing
  into Program Files. If Setup was already launched elevated/as a different user,
  Inno cannot reconstruct a different intended employee account; leave startup
  unchecked and enable it later from that employee's tray. Failure to register
  startup does not falsely claim success or enable tracking.
- Leaving startup unchecked makes no new startup change; it does not remove an
  employee's existing preference. The employee can disable/remove it in the tray.
- Optional app launch at the end is unchecked too. All regular/sign-in launches
  open the visible tray **Tracking PAUSED**. Installing never authorizes tracking
  or a backend session. Backend authentication/sync remain unavailable in the
  current application; the installer notice discloses this limitation.
- Console diagnostics remain enabled. The operational logger cannot capture all
  boot/import failures, so this release does not use windowless mode.

## Uninstall and upgrades

The stable AppId `WorkPulse.Agent` identifies this product for future upgrades.
Uninstall removes only installer-owned application files and shortcuts. There is
no `[UninstallDelete]` section, no AppData cleanup, and no credential deletion.
Employee activity queues, logs, credentials, external settings and custom paths
are retained automatically, including when uninstall is silent. This installer
does not offer any data-deletion action; removal would require a separate clear
confirmation/retention process. Unknown files are not recursively wiped.

The uninstaller removes a startup value only in its current Windows account and
only if its exact command belongs to this installed executable. It never scans
other users' hives. If elevation uses another account, the employee's value may
remain; disable startup in each employee's tray before shared-app removal. The
normal uninstall notice explains data retention and this limitation. Upgrades
must preserve the same AppId and storage locations; different-account upgrade,
reboot/sign-in and interrupted-upgrade acceptance still require test execution.

## Verification and honest platform coverage

```powershell
.\agent\venv\Scripts\python.exe -B -m unittest discover -s agent/tests -p 'test_*.py'
.\agent\venv\Scripts\python.exe -B agent/installer/verify_installer.py
```

The verifier runs a **non-admin current-user test** using `/CURRENTUSER`, a unique
temporary install directory, and a unique Start Menu group. This command-line
override is supported for controlled tests/non-admin deployments; it does not
exercise the default Program Files/elevated path. It creates synthetic data
sentinels, validates shortcuts, installed version and PAUSED native smoke, then
uninstalls and verifies data/shortcut/startup outcomes. A real startup task is
temporarily tested only if the account has no existing WorkPulse startup value;
any existing setting is preserved. It never clears employee credentials or data.

Results are in `agent/reports/installer-results.json` and `installer-report.md`.
Current evidence is Windows 11 build 26200, x64. Windows 10, clean-VM deployment,
administrator/elevation and over-the-shoulder credential flows, enterprise policy,
full interactive wizard navigation and real reboot/sign-in remain **NOT TESTED**.
The wizard privacy notice was inspected via native accessibility; this is not a
claim that every page was visually accepted. Do not infer Windows 10 acceptance
from `MinVersion` or from a Windows 11 run.

The spec allows Windows 10/11 x64 but that is targeting, not test evidence. Follow
`WINDOWS_COMPATIBILITY_TEST_PLAN.md` on both OS families before release. Check
upgrade/uninstall/data retention, opt-in startup with the intended user, actual
Program Files permissions, and unsigned/signed enterprise distribution rules.
No security policy, antivirus setting or SmartScreen barrier was bypassed.
