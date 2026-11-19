"""Isolated current-user install/uninstall test; never alters employee data.

Default Program Files/elevated installation is NOT covered by this test.
Uses a unique test directory and Start Menu group. Startup is tested only if
this account has no existing WorkPulse startup value; never overwrites one.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
from uuid import uuid4
import winreg

import win32api
from win32com.shell import shell, shellcon


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def startup_value():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            return winreg.QueryValueEx(key, "WorkPulse Agent")
    except FileNotFoundError:
        return None


def main():
    agent = Path(__file__).resolve().parents[1]
    release = runpy.run_path(str(agent / "version.py"))
    installer = agent / "dist/installer" / f"WorkPulseAgent-{release['APP_VERSION']}-Setup-x64.exe"
    before_startup = startup_value()
    group = "WorkPulse Agent Installer Test " + uuid4().hex[:8]
    programs = Path(shell.SHGetFolderPath(0, shellcon.CSIDL_PROGRAMS, None, 0)) / group
    checks = {}
    report = {"tested_at_utc": datetime.now(timezone.utc).isoformat(),
              "windows_build": __import__('sys').getwindowsversion().build,
              "mode": "Isolated current-user install, not Program Files or elevated installation",
              "version": release["APP_VERSION"], "publisher_display_name": release["PUBLISHER_DISPLAY_NAME"],
              "installer_sha256": hashlib.sha256(installer.read_bytes()).hexdigest(),
              "installer_bytes": installer.stat().st_size, "checks": checks,
              "windows_10": "NOT TESTED", "elevated_program_files_install": "NOT TESTED",
              "signing": "Unsigned; no verified publisher identity claimed"}
    with tempfile.TemporaryDirectory(prefix=".installer-test-", dir=agent) as temporary:
        root = Path(temporary)
        installed = root / "Installed WorkPulse Agent"
        profile = root / "Synthetic user data"
        profile.mkdir()
        sentinels = [profile / "activity.keep", profile / "settings.keep", profile / "logs.keep"]
        for sentinel in sentinels:
            sentinel.write_bytes(b"synthetic-data-must-survive-uninstall")
        environment = dict(os.environ, LOG_DIRECTORY=str(root / "logs"), LOCALAPPDATA=str(profile))
        uninstaller = installed / "unins000.exe"
        try:
            task = "/TASKS=startup" if before_startup is None else "/TASKS="
            setup = subprocess.run([str(installer), "/CURRENTUSER", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-",
                                    f"/DIR={installed}", f"/GROUP={group}", f"/LOG={root / 'setup.log'}", task], env=environment, capture_output=True, timeout=180)
            checks["isolated_install_exit"] = "PASS" if setup.returncode == 0 else "FAIL"
            executable = installed / "WorkPulseAgent.exe"
            checks["application_and_internal_files"] = "PASS" if executable.is_file() and (installed / "_internal/python315.dll").is_file() else "FAIL"
            checks["privacy_notice_installed"] = "PASS" if (installed / "documentation/PRIVACY.txt").is_file() else "FAIL"
            checks["start_menu_shortcut"] = "PASS" if (programs / "WorkPulse Agent.lnk").is_file() else "FAIL"
            checks["uninstall_shortcut"] = "PASS" if (programs / "Uninstall WorkPulse Agent.lnk").is_file() else "FAIL"
            product_version = win32api.GetFileVersionInfo(str(executable), "\\StringFileInfo\\040904B0\\ProductVersion")
            checks["installed_agent_version"] = "PASS" if product_version == release["APP_VERSION"] else "FAIL"
            if before_startup is None:
                expected = (subprocess.list2cmdline([str(executable), "--startup"]), winreg.REG_SZ)
                checks["optional_current_user_startup"] = "PASS" if startup_value() == expected else "FAIL"
            else:
                checks["optional_current_user_startup"] = "NOT TESTED"
                checks["existing_startup_not_changed"] = "PASS" if startup_value() == before_startup else "FAIL"
            smoke = subprocess.run([str(executable), "--smoke-test"], cwd=root, env=environment, capture_output=True, timeout=90)
            evidence = json.loads(smoke.stdout.decode("utf-8").strip().splitlines()[-1])
            report["installed_smoke"] = evidence
            checks["installed_paused_native_smoke"] = "PASS" if smoke.returncode == 0 and evidence["app_version"] == release["APP_VERSION"] else "FAIL"
        finally:
            if uninstaller.is_file():
                uninstall = subprocess.run([str(uninstaller), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], env=environment, capture_output=True, timeout=180)
                checks["uninstall_exit"] = "PASS" if uninstall.returncode == 0 else "FAIL"
            else:
                checks["uninstall_exit"] = "FAIL"
            checks["application_removed"] = "PASS" if not (installed / "WorkPulseAgent.exe").exists() else "FAIL"
            checks["start_menu_shortcuts_removed"] = "PASS" if not (programs / "WorkPulse Agent.lnk").exists() else "FAIL"
            checks["synthetic_activity_settings_logs_retained"] = "PASS" if all(path.read_bytes() == b"synthetic-data-must-survive-uninstall" for path in sentinels) else "FAIL"
            checks["original_startup_state_restored"] = "PASS" if startup_value() == before_startup else "FAIL"
            # Remove only a failed test registration pointing to our unique path.
            current = startup_value()
            if before_startup is None and current is not None and str(installed) in current[0]:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
                    winreg.DeleteValue(key, "WorkPulse Agent")
    report["status"] = "FAIL" if "FAIL" in checks.values() else "PASS"
    destination = agent / "reports/installer-results.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return int(report["status"] != "PASS")


if __name__ == "__main__":
    raise SystemExit(main())
