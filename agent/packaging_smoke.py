"""Explicit executable smoke mode: native dependencies + visible PAUSED tray.

No input listeners, uploads, login, credentials, or startup registration writes.
The timer requests a normal tray exit; no background tracking is started.
"""
import importlib
import json
import platform
import sqlite3
import sys
from threading import Timer
from zoneinfo import ZoneInfo


def run():
    checks = {}
    modules = ("pynput.mouse._win32", "pynput.keyboard._win32", "pystray._win32",
               "psutil._psutil_windows", "win32api", "win32gui", "win32process",
               "win32security", "win32file", "win32crypt", "win32cred", "pywintypes",
               "agent.ui.login", "agent.core.offline_queue", "requests", "PIL.Image")
    for name in modules:
        try:
            importlib.import_module(name)
            checks[name] = "PASS"
        except Exception:
            checks[name] = "FAIL"
    try:
        ZoneInfo("Asia/Colombo")
        ZoneInfo("America/New_York")
        checks["timezone_data"] = "PASS"
        with sqlite3.connect(":memory:") as database:
            checks["sqlite"] = "PASS" if database.execute("SELECT 1").fetchone() == (1,) else "FAIL"
        import win32crypt
        protected = win32crypt.CryptProtectData(b"synthetic-packaging-test", None, None, None, None, 0)
        checks["dpapi"] = "PASS" if win32crypt.CryptUnprotectData(protected, None, None, None, 0)[1] == b"synthetic-packaging-test" else "FAIL"
        import certifi
        from pathlib import Path
        checks["ca_bundle"] = "PASS" if Path(certifi.where()).is_file() else "FAIL"
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        root.update_idletasks()
        root.destroy()
        checks["tk_native"] = "PASS"
        from .core.windows_startup import WindowsStartup
        command = WindowsStartup.command()  # Build string only, never write registry.
        checks["executable_startup_path"] = "PASS" if sys.executable in command and command.endswith("--startup") else "FAIL"
        from .ui.tray import WorkPulseTray
        tray = WorkPulseTray()
        timer = Timer(3, lambda: tray.request("exit"))
        timer.start()
        try:
            tray.run()
            checks["visible_paused_tray_exit"] = "PASS" if (
                tray._agent is None and not tray._requested and tray._manual_stop.is_set()
                and tray.state.snapshot()[0] == "Tracking PAUSED") else "FAIL"
        finally:
            timer.cancel()
    except Exception:
        checks["native_runtime"] = "FAIL"
    from .version import APP_VERSION, APP_NAME, PUBLISHER_DISPLAY_NAME
    result = {"app_name": APP_NAME, "app_version": APP_VERSION, "publisher_display_name": PUBLISHER_DISPLAY_NAME,
              "frozen": bool(getattr(sys, "frozen", False)), "python": platform.python_version(),
              "windows_build": sys.getwindowsversion().build, "checks": checks,
              "limitations": "Dependency/paused-tray smoke only; no tracking, backend auth/upload, real startup registration, clean-machine or Windows 10 acceptance."}
    print(json.dumps(result, sort_keys=True), flush=True)
    return int(any(value == "FAIL" for value in checks.values()))
