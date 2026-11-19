"""Mocked registry tests. Never create a real Windows logon startup entry."""
from contextlib import nullcontext
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import winreg

from agent.core.windows_startup import StartupError, WindowsStartup
from agent.start_agent import main


class WindowsStartupTests(unittest.TestCase):
    def setUp(self):
        self.key = object()
        self.value = None
        self.calls = []
        def open_key(root, path, reserved, access):
            self.assertEqual(root, winreg.HKEY_CURRENT_USER)
            self.assertEqual(path, WindowsStartup.RUN_KEY)
            self.calls.append(access)
            return nullcontext(self.key)
        def query(key, name):
            self.assertIs(key, self.key)
            self.assertEqual(name, WindowsStartup.VALUE_NAME)
            if self.value is None:
                raise FileNotFoundError
            return self.value
        def write(key, name, reserved, kind, command):
            self.assertIs(key, self.key)
            self.assertEqual(name, "WorkPulse Agent")
            self.value = command, kind
        def delete(key, name):
            self.assertIs(key, self.key)
            self.assertEqual(name, "WorkPulse Agent")
            if self.value is None:
                raise FileNotFoundError
            self.value = None
        self.api = {}
        for name, handler in (("OpenKey", open_key), ("CreateKeyEx", open_key),
                              ("QueryValueEx", query), ("SetValueEx", write), ("DeleteValue", delete)):
            patcher = patch("agent.core.windows_startup.winreg." + name, side_effect=handler)
            self.api[name] = patcher.start()
            self.addCleanup(patcher.stop)
        self.startup = WindowsStartup()

    def test_construction_and_status_never_register_anything(self):
        self.assertEqual(self.startup.status(), "Not registered")
        self.api["CreateKeyEx"].assert_not_called()
        self.api["SetValueEx"].assert_not_called()
        self.api["DeleteValue"].assert_not_called()

    def test_explicit_enable_uses_hkcu_visible_name_and_reg_sz_then_remove(self):
        self.startup.enable()
        self.assertEqual(self.value, (self.startup.command(), winreg.REG_SZ))
        self.assertEqual(self.startup.status(), "Registered (opens paused)")
        self.startup.remove()
        self.startup.remove()
        self.assertEqual(self.startup.status(), "Not registered")
        self.assertTrue(all(access in (winreg.KEY_SET_VALUE, winreg.KEY_QUERY_VALUE) for access in self.calls))

    def test_existing_different_entry_is_not_overwritten(self):
        self.value = ("old-install.exe", winreg.REG_SZ)
        self.assertIn("Different entry", self.startup.status())
        with self.assertRaises(StartupError):
            self.startup.enable()
        self.api["SetValueEx"].assert_not_called()
        # Explicit removal remains possible even for a stale installation path.
        self.startup.remove()
        self.assertIsNone(self.value)

    def test_registry_permissions_fail_safely_without_elevation(self):
        self.api["OpenKey"].side_effect = PermissionError("private OS detail")
        with self.assertRaises(StartupError) as error:
            self.startup.status()
        self.assertNotIn("private OS detail", str(error.exception))
        with self.assertRaises(StartupError):
            self.startup.remove()
        self.api["SetValueEx"].assert_not_called()

    def test_write_error_is_sanitized_and_no_success_entry_appears(self):
        self.api["SetValueEx"].side_effect = PermissionError("private detail")
        with self.assertRaises(StartupError) as error:
            self.startup.enable()
        self.assertNotIn("private detail", str(error.exception))
        self.assertIsNone(self.value)

    def test_packaged_command_quotes_actual_executable_path(self):
        with patch("agent.core.windows_startup.sys.frozen", True, create=True), patch("agent.core.windows_startup.sys.executable", r"C:\Program Files\WorkPulse\WorkPulseAgent.exe"), patch.object(Path, "is_file", return_value=True):
            self.assertEqual(self.startup.command(), '"C:\\Program Files\\WorkPulse\\WorkPulseAgent.exe" --startup')

    def test_source_command_is_absolute_and_independent_of_working_directory(self):
        command = self.startup.command()
        self.assertIn(str(Path(__file__).resolve().parents[1] / "start_agent.py"), command)
        self.assertIn(" -I ", command)
        self.assertTrue(command.endswith(" --startup"))

    def test_missing_or_excessive_path_never_registers(self):
        with patch.object(Path, "is_file", return_value=False):
            with self.assertRaises(StartupError):
                self.startup.enable()
        with patch("agent.core.windows_startup.sys.frozen", True, create=True), patch("agent.core.windows_startup.sys.executable", "C:\\" + "a" * 260 + ".exe"), patch.object(Path, "is_file", return_value=True):
            with self.assertRaises(StartupError):
                self.startup.enable()
        self.api["SetValueEx"].assert_not_called()

    def test_startup_launcher_only_opens_visible_desktop(self):
        with patch("sys.argv", ["start_agent.py", "--startup"]), patch("agent.ui.desktop.run_desktop", return_value=0) as desktop:
            self.assertEqual(main(), 0)
        desktop.assert_called_once_with(diagnostic=False, exercise_error=False, diagnostics_file=None)

    def test_packaging_diagnostics_do_not_run_normal_tracking_launcher(self):
        with patch("sys.argv", ["start_agent.py", "--smoke-test"]), patch("agent.packaging_smoke.run", return_value=0) as diagnostic, patch("agent.ui.tray.WorkPulseTray") as tray:
            self.assertEqual(main(), 0)
        diagnostic.assert_called_once_with(diagnostics_file=None)
        tray.assert_not_called()

    def test_explicit_installer_startup_action_never_opens_tracking(self):
        for flag, action in (("--enable-startup", "enable"), ("--disable-startup", "remove")):
            with self.subTest(flag=flag), patch("sys.argv", ["start_agent.py", flag]), patch("agent.core.windows_startup.WindowsStartup") as startup, patch("agent.utils.logger.configure_logging"), patch("agent.ui.tray.WorkPulseTray") as tray, patch("builtins.print"):
                self.assertEqual(main(), 0)
            getattr(startup.return_value, action).assert_called_once_with()
            tray.assert_not_called()


if __name__ == "__main__":
    unittest.main()
