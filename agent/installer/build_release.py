"""Validate the existing UI bundle and compile agent/release/WorkPulseAgentSetup.exe.

Preserves all existing application sources, specs and legacy installer scripts.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess

import win32api


def main():
    agent = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", type=Path, default=Path(os.environ["LOCALAPPDATA"]) / "Programs/Inno Setup 7/ISCC.exe")
    parser.add_argument("--bundle", type=Path, default=agent / "dist/gui/WorkPulseAgent",
                        help="Validated onedir GUI bundle; permits isolated builds while an older app is open")
    options = parser.parse_args()
    executable = options.bundle.resolve() / "WorkPulseAgent.exe"
    internal = executable.parent / "_internal"
    if not executable.is_file() or not internal.is_dir():
        raise SystemExit("The GUI bundle is missing; build packaging/WorkPulseAgent-gui.spec and verify it first.")
    import pefile
    with pefile.PE(str(executable), fast_load=True) as image:
        if image.OPTIONAL_HEADER.Subsystem != 2:
            raise SystemExit("Installer requires the verified windowed GUI build, not a console executable.")
    if not options.compiler.is_file():
        raise SystemExit("Inno Setup compiler not found; supply --compiler with the installed ISCC.exe path.")
    resource = "\\StringFileInfo\\040904B0\\"
    for field, expected in (("ProductVersion", "1.0.0"), ("ProductName", "WorkPulse Agent"), ("CompanyName", "WorkPulse")):
        if win32api.GetFileVersionInfo(str(executable), resource + field).strip() != expected:
            raise SystemExit("Selected executable does not match required Agent 1.0.0 metadata.")
    forbidden = {"venv", ".venv", "node_modules", ".git", "tests", "reports", "logs"}
    for path in internal.rglob("*"):
        if not path.is_file():
            continue
        parts = {part.lower() for part in path.relative_to(internal).parts}
        filename = path.name.lower()
        if (parts & forbidden or filename.startswith((".env", "credentials.", "secrets.", "tokens."))
                or path.suffix.lower() in {".sqlite3", ".key"}):
            raise SystemExit("Unexpected development/private data in runtime bundle; compilation refused.")
    build = agent / "build"
    build.mkdir(exist_ok=True)
    command = [str(options.compiler), "/DAgentBundleDir=" + str(executable.parent), str(agent / "WorkPulseAgent.iss")]
    compiled = subprocess.run(command, cwd=agent, capture_output=True)
    (build / "release-compile.log").write_bytes(compiled.stdout + compiled.stderr)
    if compiled.returncode:
        print(compiled.stdout.decode(errors="replace")[-3000:])
        print(compiled.stderr.decode(errors="replace")[-3000:])
        return compiled.returncode
    output = agent / "release/WorkPulseAgentSetup.exe"
    if not output.is_file():
        raise SystemExit("Compiler exited without the required release/WorkPulseAgentSetup.exe output.")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (output.parent / "WorkPulseAgentSetup.exe.sha256").write_text(f"{digest}  {output.name}\n", encoding="ascii")
    report = {"compiled_at_utc": datetime.now(timezone.utc).isoformat(), "compiler": str(options.compiler),
              "output": str(output), "bytes": output.stat().st_size, "sha256": digest,
              "source_executable": str(executable), "version": "1.0.0", "publisher_display_name": "WorkPulse (provisional)",
              "compilation": "PASS", "signing": "Not configured", "errors": [],
              "target_os": ["Windows 10 x64", "Windows 11 x64"], "windows_10_execution": "NOT TESTED"}
    (output.parent / "build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
