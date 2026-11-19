"""Explicit opt-in HKCU Run registration; importing never touches the registry."""
from pathlib import Path
import subprocess
import sys
import winreg


class StartupError(RuntimeError):
    """User-safe startup configuration failure."""


class WindowsStartup:
    """Manage only the visible WorkPulse Agent value for the current user.

    No machine keys, scheduled tasks, elevation, startup approval overrides,
    automatic repair, or registration on launch. Windows can disable/delay Run
    entries independently; 'enabled' here means the expected entry is registered.
    """
    RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
    VALUE_NAME = "WorkPulse Agent"

    @staticmethod
    def command():
        """Use the current packaged executable or the actual source interpreter.

        Source mode uses an absolute bootstrap script, independent of logon CWD.
        A packaged build must use start_agent.py as its entry point.
        """
        executable = Path(sys.executable)
        if not executable.is_absolute() or not executable.is_file() or executable.suffix.lower() != ".exe":
            raise StartupError("The WorkPulse executable is unavailable; reinstall before enabling startup.")
        if getattr(sys, "frozen", False):
            arguments = [str(executable), "--startup"]
        else:
            if executable.name.lower() != "python.exe":
                raise StartupError("Source startup requires the visible python.exe interpreter.")
            launcher = Path(__file__).resolve().parents[1] / "start_agent.py"
            if not launcher.is_file():
                raise StartupError("The WorkPulse startup launcher is missing.")
            arguments = [str(executable), "-I", str(launcher), "--startup"]
        command = subprocess.list2cmdline(arguments)
        # Run key commands are limited to 260 UTF-16 code units by Windows.
        if len(command.encode("utf-16-le")) // 2 > 260:
            raise StartupError("The startup path is too long. Install WorkPulse in a shorter directory.")
        return command

    def _read(self):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self.RUN_KEY, 0, winreg.KEY_QUERY_VALUE) as key:
                return winreg.QueryValueEx(key, self.VALUE_NAME)
        except FileNotFoundError:
            return None
        except OSError:
            raise StartupError("Windows could not read WorkPulse startup settings.") from None

    def status(self):
        """Read this app's own value only. Never enumerate other startup entries."""
        current = self._read()
        if current is None:
            return "Not registered"
        try:
            expected = self.command()
        except StartupError:
            return "Entry exists; installation needs attention"
        return "Registered (opens paused)" if current == (expected, winreg.REG_SZ) else "Different entry exists; remove before enabling"

    def enable(self):
        """Called only by explicit employee action; never at import or startup."""
        command = self.command()
        current = self._read()
        if current is not None and current != (command, winreg.REG_SZ):
            raise StartupError("A different WorkPulse startup entry exists. Remove it explicitly before enabling.")
        try:
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, self.RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.SetValueEx(key, self.VALUE_NAME, 0, winreg.REG_SZ, command)
        except OSError:
            raise StartupError("Windows denied the startup change. No administrator elevation was attempted.") from None

    def remove(self):
        """Disable by deleting this app's named value only; missing is success."""
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self.RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, self.VALUE_NAME)
        except FileNotFoundError:
            return
        except OSError:
            raise StartupError("Windows could not remove the WorkPulse startup entry.") from None
