"""Isolated verification of the new release installer; no working source changes."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile
import shutil
from uuid import uuid4
import winreg

from win32com.shell import shell, shellcon
import win32com.client
import win32event
from unittest.mock import patch


def main():
    agent = Path(__file__).resolve().parents[1]
    installer = agent / "release/WorkPulseAgentSetup.exe"
    report = {"tested_at_utc": datetime.now(timezone.utc).isoformat(),
              "windows_build": __import__('sys').getwindowsversion().build,
              "mode": "Isolated per-user installation; elevated Program Files path not tested",
              "checks": {}, "windows_10": "NOT TESTED"}
    checks = report["checks"]
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkPulse.Agent_is1"):
            report["status"] = "NOT TESTED"
            report["reason"] = "Existing current-user installation preserved; use a clean test account."
            (agent / "release/verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            return 0
    except FileNotFoundError:
        pass
    desktop = Path(shell.SHGetFolderPath(0, shellcon.CSIDL_DESKTOPDIRECTORY, None, 0)) / "WorkPulse Agent.lnk"
    desktop_existed = desktop.exists()
    group = "WorkPulse Release Test " + uuid4().hex[:8]
    programs = Path(shell.SHGetFolderPath(0, shellcon.CSIDL_PROGRAMS, None, 0)) / group
    with tempfile.TemporaryDirectory(prefix="release-test-", dir=agent / "build") as directory:
        root = Path(directory)
        installed = root / "Installed WorkPulse Agent"
        retained = root / "Synthetic employee data.keep"
        retained.write_bytes(b"retain-synthetic-data")
        environment = dict(os.environ, LOG_DIRECTORY=str(root / "logs"), LOCALAPPDATA=str(root / "Synthetic profile"))
        uninstaller = installed / "unins000.exe"
        test_link = desktop.parent / ("WorkPulse GUI Launch Test " + uuid4().hex[:8] + ".lnk")
        try:
            task = "/TASKS=" if desktop_existed else "/TASKS=desktopicon"
            result = subprocess.run([str(installer), "/CURRENTUSER", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", f"/DIR={installed}", f"/GROUP={group}", task],
                                    env=environment, capture_output=True, timeout=180)
            checks["install"] = "PASS" if result.returncode == 0 else "FAIL"
            checks["start_menu"] = "PASS" if (programs / "WorkPulse Agent.lnk").is_file() else "FAIL"
            checks["desktop_shortcut_opt_in"] = "NOT TESTED" if desktop_existed else ("PASS" if desktop.is_file() else "FAIL")
            checks["runtime_payload"] = "PASS" if (installed / "_internal").is_dir() else "FAIL"
            checks["privacy_and_user_guide"] = "PASS" if all((installed / "documentation" / filename).is_file() for filename in ("PRIVACY.txt", "USER_GUIDE.txt")) else "FAIL"
            checks["no_development_guides"] = "PASS" if not (installed / "documentation/BUILDING.md").exists() and not (installed / "documentation/README.md").exists() else "FAIL"
            native_result = root / "native-result.json"
            smoke = subprocess.run([str(installed / "WorkPulseAgent.exe"), "--smoke-test", "--diagnostics-file", str(native_result)], cwd=root, env=environment, capture_output=True, timeout=90)
            evidence = json.loads(native_result.read_text(encoding="utf-8"))
            checks["installed_paused_native_smoke"] = "PASS" if smoke.returncode == 0 and evidence["app_version"] == "1.0.0" else "FAIL"
            report["installed_smoke"] = evidence
            # Exercise a real desktop .lnk without modifying an employee's link.
            shutil.copy2(programs / "WorkPulse Agent.lnk", test_link)
            link = win32com.client.Dispatch("WScript.Shell").CreateShortcut(str(test_link))
            checks["desktop_link_target"] = "PASS" if Path(link.TargetPath).resolve() == (installed / "WorkPulseAgent.exe").resolve() else "FAIL"
            gui_result = root / "desktop-launch.json"
            link.Arguments = subprocess.list2cmdline(["--gui-smoke-test", "--diagnostics-file", str(gui_result)])
            link.Save()
            del link
            with patch.dict(os.environ, environment, clear=True):
                launch = shell.ShellExecuteEx(fMask=shellcon.SEE_MASK_NOCLOSEPROCESS, lpFile=str(test_link), nShow=1)
                handle = launch.get("hProcess")
                if handle:
                    win32event.WaitForSingleObject(handle, 60000)
                    handle.Close()
            gui = json.loads(gui_result.read_text(encoding="utf-8")) if gui_result.is_file() else {}
            checks["installed_desktop_shortcut_opens_paused_gui"] = "PASS" if gui.get("window_was_visible") and gui.get("tracking_never_started") else "FAIL"
            report["desktop_shortcut_gui"] = gui
        finally:
            test_link.unlink(missing_ok=True)
            if uninstaller.is_file():
                removal = subprocess.run([str(uninstaller), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], env=environment, capture_output=True, timeout=180)
                checks["uninstall"] = "PASS" if removal.returncode == 0 else "FAIL"
            else:
                checks["uninstall"] = "FAIL"
            checks["app_and_start_menu_removed"] = "PASS" if not (installed / "WorkPulseAgent.exe").exists() and not (programs / "WorkPulse Agent.lnk").exists() else "FAIL"
            checks["desktop_removed"] = "NOT TESTED" if desktop_existed else ("PASS" if not desktop.exists() else "FAIL")
            checks["synthetic_data_retained"] = "PASS" if retained.read_bytes() == b"retain-synthetic-data" else "FAIL"
    report["status"] = "FAIL" if "FAIL" in checks.values() else "PASS"
    (agent / "release/verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return int(report["status"] == "FAIL")


if __name__ == "__main__":
    raise SystemExit(main())
