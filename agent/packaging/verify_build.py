"""Test a relocated Windows bundle, without starting activity tracking."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("onedir", "onefile"))
    options = parser.parse_args()
    agent = Path(__file__).resolve().parents[1]
    executable = agent / "dist" / options.mode / ("WorkPulseAgent/WorkPulseAgent.exe" if options.mode == "onedir" else "WorkPulseAgent.exe")
    if not executable.is_file():
        raise SystemExit("Build the selected executable first.")
    checks = {}
    with tempfile.TemporaryDirectory(prefix=".packaging-smoke-", dir=agent) as directory:
        temporary = Path(directory)
        installed = temporary / "Installed WorkPulse Agent"
        installed.mkdir()
        if options.mode == "onedir":
            shutil.copytree(executable.parent, installed, dirs_exist_ok=True)
        else:
            shutil.copy2(executable, installed / executable.name)
        relocated = installed / executable.name
        environment = dict(os.environ)
        for key in ("PYTHONHOME", "PYTHONPATH", "TCL_LIBRARY", "TK_LIBRARY"):
            environment.pop(key, None)
        environment["LOG_DIRECTORY"] = str(temporary / "logs")
        environment["OFFLINE_QUEUE_PATH"] = str(temporary / "queue" / "test.sqlite3")
        cwd = temporary / "Unrelated working directory"
        cwd.mkdir()
        help_result = subprocess.run([str(relocated), "--help"], cwd=cwd, env=environment, capture_output=True, timeout=30)
        checks["help_command"] = "PASS" if help_result.returncode == 0 and b"--smoke-test" in help_result.stdout else "FAIL"
        smoke = subprocess.run([str(relocated), "--smoke-test"], cwd=cwd, env=environment, capture_output=True, timeout=90)
        checks["smoke_exit_code"] = "PASS" if smoke.returncode == 0 else "FAIL"
        try:
            evidence = json.loads(smoke.stdout.decode("utf-8").strip().splitlines()[-1])
            checks["frozen_runtime"] = "PASS" if evidence["frozen"] is True else "FAIL"
        except (ValueError, KeyError, IndexError):
            evidence = {"checks": {}, "limitations": "Executable did not return valid diagnostic evidence."}
            checks["frozen_runtime"] = "FAIL"
        log = temporary / "logs" / "workpulse.log"
        checks["lifecycle_log"] = "PASS" if log.is_file() and "Application shutdown completed" in log.read_text(encoding="utf-8") else "FAIL"
        checks["no_offline_queue_created"] = "PASS" if not (temporary / "queue").exists() else "FAIL"
    report = {
        "tested_at_utc": datetime.now(timezone.utc).isoformat(), "mode": options.mode,
        "windows_build": sys.getwindowsversion().build, "console_enabled": True,
        "artifact_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "artifact_bytes": executable.stat().st_size,
        "checks": {**checks, **evidence["checks"]}, "runtime": evidence,
        "limitations": "Relocated package with spaces and unrelated CWD on current Windows host; not clean-machine or Windows 10 acceptance. No employee tracking, backend calls or startup writes.",
    }
    report["status"] = "PASS" if all(value == "PASS" for value in report["checks"].values()) else "FAIL"
    reports = agent / "reports"
    reports.mkdir(exist_ok=True)
    (reports / f"packaging-{options.mode}-results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return int(report["status"] != "PASS")


if __name__ == "__main__":
    raise SystemExit(main())
