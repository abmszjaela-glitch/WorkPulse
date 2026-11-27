# WorkPulse Agent Windows release

The main entry point is start_agent.py. The release uses packaging/WorkPulseAgent-gui.spec and the root WorkPulseAgent.iss. Console-enabled onedir/onefile specs remain available for diagnostics. All specs share packaging/build_common.py.

Version and publisher display metadata are defined in version.py. The current release is WorkPulse Agent 1.0.0, with WorkPulse as a provisional publisher display name. Digital signing is not configured. Update the installer metadata alongside version.py before changing a release version; the build helper rejects a mismatched executable.

## Build from the repository root

    .\agent\venv\Scripts\python.exe -B -m unittest discover -s agent/tests -p 'test_*.py'
    .\agent\venv\Scripts\python.exe -B -m PyInstaller --noconfirm --distpath agent/dist/gui --workpath agent/build/gui agent/packaging/WorkPulseAgent-gui.spec
    .\agent\venv\Scripts\python.exe -B agent/packaging/verify_desktop.py --exe agent/dist/gui/WorkPulseAgent/WorkPulseAgent.exe
    .\agent\venv\Scripts\python.exe -B agent/installer/build_release.py
    .\agent\venv\Scripts\python.exe -B agent/installer/verify_release.py

The compiler defaults to the installed Inno Setup 7 under LOCALAPPDATA/Programs. Supply --compiler with the installed ISCC.exe path if needed. If a bundle is running, use a separate dist/work directory, verify that bundle, then pass --bundle to build_release.py. Never replace loaded runtime DLLs.

Output: release/WorkPulseAgentSetup.exe, with checksum and build/verification metadata. The latest existing verified input is recorded in release/build-report.json; cleanup preserves that bundle and the release outputs. Rebuild the default dist/gui path before compiling without --bundle. Build caches and obsolete preview bundles can be regenerated and are ignored by Git.

## Installation and privacy

The installer defaults to Program Files, creates Start Menu shortcuts and offers unchecked desktop/startup options. It packages only the executable, complete _internal runtime folder and installer/PRIVACY.txt plus installer/USER_GUIDE.txt. It excludes the venv, development source, tests, credentials, .env files and employee databases/logs.

Launch opens a visible PAUSED desktop window and tray. Sign-in, applicable authorization, consent and an explicit Start action are required before tracking. Installation and startup registration do not authorize monitoring. Uninstall preserves employee data and credentials; it does not delete AppData.

The verifier uses an isolated current-user installation and preserves existing installations. See release/verification.json for actual results. Windows 10 and Windows 11 are targets; only executed tests count as coverage. Follow WINDOWS_COMPATIBILITY_TEST_PLAN.md for remaining platform and clean-machine checks.
