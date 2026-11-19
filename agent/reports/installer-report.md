# WorkPulse Agent 1.0.0 installer execution report

Artifact: `agent/dist/installer/WorkPulseAgent-1.0.0-Setup-x64.exe`

Final verification: **2026-11-19 11:19:50 UTC**, Windows 11 x64, build 26200.
SHA-256: `c16124dcd4f1c312f2775ff4e4c82f284feae095ae748bc8043f6acad275ff70`

Product name: WorkPulse Agent. Agent release: **1.0.0**, independent of backend
versions. Description: WorkPulse Employee Activity Tracking Agent. Publisher
display: **WorkPulse**, supplied by the user as provisional metadata, not a
verified legal identity. `agent/version.py` drives the tray/About UI, both
refreshed executable resources and installer. Resources were read back to
confirm version/display consistency. Installer Authenticode status: **NotSigned**.

## Actual checks

Automated installation used `/CURRENTUSER`, a unique temporary install directory
and Start Menu group. It did **not** exercise default Program Files/elevation.
Only synthetic activity/settings/log sentinels were used. Startup was temporarily
enabled for the current test account and its original state restored. Existing
employee data and credentials were untouched. See `installer-results.json`.

| Check | Result |
|---|---|
| Final Inno Setup compile | PASS |
| Isolated current-user installation | PASS |
| Application/DLL/config/resource payload installed | PASS |
| Privacy notice installed | PASS |
| Start Menu application and uninstall shortcuts | PASS |
| Installed Agent version matches central 1.0.0 metadata | PASS |
| Optional current-user startup | PASS |
| Installed native dependency / visible PAUSED tray smoke | PASS |
| Uninstall and installed application removal | PASS |
| Start Menu shortcut removal | PASS |
| Synthetic activity/settings/log data survives uninstall | PASS |
| Original startup state restored | PASS |
| Wizard title and privacy notice text | PASS, limited native accessibility inspection |
| Refreshed onedir and onefile relocated smoke | PASS |
| Source regression suite | PASS, 170 tests |
| Full interactive wizard flow and every page/control | NOT TESTED |
| Elevated Program Files installation and different-account UAC | NOT TESTED |
| Windows 10 install/uninstall | NOT TESTED |
| Clean-machine, enterprise policy, real sign-in/reboot and upgrades | NOT TESTED |
| Backend authentication/JWT/upload | NOT TESTED; implementations/contracts absent |
| Digital signing / verified publisher | NOT CONFIGURED; no claim made |

An intermediate shortcut test failed because Inno ignores `/GROUP` when the
Start Menu folder page is hidden. Enabling the folder page corrected it; the
table reflects successful verification of the final installer. The native notice
was inspected, but further wizard interaction was not completed after the target
window became unavailable. This is not full visual acceptance.

## Safety and release limits

Default installation targets x64 Program Files with administrator authorization.
The command-line per-user mode used by testing is an additional deployment mode.
Startup is unchecked and uses the installed app's explicit current-user action
in the original user's context. It never starts tracking. Launch Setup normally;
when already elevated as another account, enable startup later in the intended
employee's tray. No other users' registry hives are scanned or modified.

There are no AppData deletion or `[UninstallDelete]` rules. Activity queues, logs,
credentials and custom settings are retained on uninstall; no data-deletion option
is offered. Unknown files are not recursively wiped. Only the current account's
startup command owned by this exact installation is removed. Other accounts must
manage their own startup preference.

This is an **unsigned initial installer build**, not production acceptance.
The Inno Setup compiler reported **"Non-commercial use only"**; a commercial
compiler license was not provided/configured. Use the appropriate licensed build
environment for commercial release. Windows 10 and elevated Program Files tests
remain pending actual execution. No Windows security or authorization barrier
was bypassed. Build/release instructions are in `agent/installer/README.md`.
