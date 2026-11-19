"""Compile the existing one-folder distribution with centralized release data."""
import argparse
from pathlib import Path
import re
import runpy
import subprocess

import win32api


def main():
    directory = Path(__file__).resolve().parent
    agent = directory.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", type=Path, default=agent / "build/tools/InnoSetup/ISCC.exe")
    options = parser.parse_args()
    release = runpy.run_path(str(agent / "version.py"))
    if not re.fullmatch(r"\d+\.\d+\.\d+", release["APP_VERSION"]):
        raise SystemExit("APP_VERSION must be a three-part numeric Agent release version.")
    executable = agent / "dist/gui/WorkPulseAgent/WorkPulseAgent.exe"
    if not executable.is_file():
        raise SystemExit("Build and verify packaging/WorkPulseAgent-gui.spec before compiling the installer.")
    resource = "\\StringFileInfo\\040904B0\\"
    for key, field in (("APP_VERSION", "ProductVersion"), ("APP_NAME", "ProductName"),
                       ("PUBLISHER_DISPLAY_NAME", "CompanyName"), ("APP_DESCRIPTION", "FileDescription")):
        if win32api.GetFileVersionInfo(str(executable), resource + field) != release[key]:
            raise SystemExit("Executable metadata differs from agent/version.py; rebuild the one-folder application first.")
    if not options.compiler.is_file():
        raise SystemExit("Supply the installed official Inno Setup compiler using --compiler.")
    metadata = {"AgentName": release["APP_NAME"], "AgentVersion": release["APP_VERSION"],
                "PublisherDisplayName": release["PUBLISHER_DISPLAY_NAME"], "AgentDescription": release["APP_DESCRIPTION"]}
    if any(any(char in value for char in '\r\n";') for value in metadata.values()):
        raise SystemExit("Release display fields must be single-line plain text without quotes or semicolons.")
    command = [str(options.compiler), *[f"/D{key}={value}" for key, value in metadata.items()], str(directory / "WorkPulseAgent.iss")]
    return subprocess.run(command, cwd=directory).returncode


if __name__ == "__main__":
    raise SystemExit(main())
