"""Real desktop launch/error checks; no employee tracking or backend calls."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    agent = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", type=Path)
    options = parser.parse_args()
    command = [str(options.exe.resolve())] if options.exe else [sys.executable, "-B", str(agent / "start_agent.py")]
    report = {"executed_at_utc": datetime.now(timezone.utc).isoformat(), "windows_build": sys.getwindowsversion().build,
              "target": str(options.exe) if options.exe else "source", "checks": {}}
    checks = report["checks"]
    if options.exe:
        import pefile
        with pefile.PE(str(options.exe), fast_load=True) as executable:
            checks["windows_gui_subsystem_no_console"] = "PASS" if executable.OPTIONAL_HEADER.Subsystem == 2 else "FAIL"
    with tempfile.TemporaryDirectory(prefix="desktop-launch-test-", dir=agent / "build") as temporary:
        directory = Path(temporary)
        for name, extra in (("normal", []), ("callback_error", ["--exercise-gui-error"]), ("invalid_configuration", [])):
            logdir = directory / name
            resultfile = directory / (name + ".json")
            environment = dict(os.environ, LOG_DIRECTORY=str(logdir))
            if name == "invalid_configuration":
                environment["IDLE_THRESHOLD"] = "fabricated-private-setting"
            process = subprocess.run(command + ["--gui-smoke-test", "--diagnostics-file", str(resultfile)] + extra,
                                     cwd=directory, env=environment, capture_output=True, timeout=60)
            if name == "invalid_configuration":
                recovery = logdir / "startup-error.log"
                text = recovery.read_text(encoding="utf-8") if recovery.is_file() else ""
                checks["early_configuration_error_logged"] = "PASS" if process.returncode != 0 and text and "fabricated-private-setting" not in text else "FAIL"
            else:
                evidence = json.loads(resultfile.read_text(encoding="utf-8")) if resultfile.is_file() else {}
                checks[name + "_desktop_visible_paused"] = "PASS" if process.returncode == 0 and evidence.get("window_was_visible") and evidence.get("tray_was_visible") and evidence.get("tracking_never_started") else "FAIL"
                text = (logdir / "workpulse.log").read_text(encoding="utf-8") if (logdir / "workpulse.log").is_file() else ""
                if name == "callback_error":
                    checks["callback_error_logged_without_private_details"] = "PASS" if evidence.get("callback_error_seen") and "Desktop callback failed" in text and "fabricated-private-error" not in text else "FAIL"
                report[name] = evidence
    report["status"] = "FAIL" if "FAIL" in checks.values() else "PASS"
    destination = agent / "reports" / ("desktop-windowed-results.json" if options.exe else "desktop-source-results.json")
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return int(report["status"] == "FAIL")


if __name__ == "__main__":
    raise SystemExit(main())
