# Windows executable builds

The packaged entry point is ../start_agent.py. All supported specs share build_common.py; the retired duplicate root spec and installer wrapper have been removed.

- WorkPulseAgent-gui.spec: windowed one-folder desktop release with CustomTkinter and visible tray status.
- WorkPulseAgent-onedir.spec: console-enabled one-folder diagnostic build.
- WorkPulseAgent-onefile.spec: console-enabled one-file build, after onedir validation.

Use ../BUILD_RELEASE.md for the maintained GUI build, desktop error checks, installer compilation and installation verification commands. Source and executable failures are captured by the desktop bootstrap/logger; windowless startup is checked by verify_desktop.py.

## Runtime dependencies and configuration

The helper includes Windows backends for pynput/pystray, pywin32 credential/DPAPI/ACL APIs, psutil, CustomTkinter themes/fonts, Tcl/Tk, Pillow, IANA tzdata and public CA certificates. Configuration is compiled from ../config/config.py and can use the documented environment overrides. It does not bundle backend .env files, development credentials, queues, logs, reports, tests or the venv directory.

Build Windows binaries on Windows using the project requirements. Product/version/publisher resource values come from ../version.py. These inputs are reproducible commands, not a claim of bit-identical binaries across different toolchains.

## Diagnostic builds from the repository root

    .\agent\venv\Scripts\python.exe -B -m PyInstaller --noconfirm --distpath agent/dist/onedir --workpath agent/build/onedir agent/packaging/WorkPulseAgent-onedir.spec
    .\agent\venv\Scripts\python.exe -B agent/packaging/verify_build.py onedir

After the onedir checks pass:

    .\agent\venv\Scripts\python.exe -B -m PyInstaller --noconfirm --distpath agent/dist/onefile --workpath agent/build/onefile agent/packaging/WorkPulseAgent-onefile.spec
    .\agent\venv\Scripts\python.exe -B agent/packaging/verify_build.py onefile

The diagnostic verifier relocates a copy, checks native dependencies and visible PAUSED launch, and never starts input listeners. Reports are generated under ../reports. This does not replace authorized input, backend, long-soak or clean-machine testing.

Build outputs and caches are ignored by Git. Keep the complete onedir bundle, including _internal, when distributing it. If an executable is running, build to a separate directory rather than replacing loaded DLLs. The release builder accepts --bundle for a separately verified GUI bundle.

Windows 10/11 are supported targets; only tests actually executed on an OS count as coverage. No signing certificate or verified legal publisher identity is configured. See ../WINDOWS_COMPATIBILITY_TEST_PLAN.md and ../release/verification.json for the test plan and latest installer evidence.
