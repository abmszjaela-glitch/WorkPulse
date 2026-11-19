"""Visible entry point for source startup and packaged Windows builds.

    python agent/start_agent.py [--startup]

--startup discloses launch origin only; it never starts tracking, authenticates,
restores a tracking session, or writes/repairs the Windows startup registration.
"""
import argparse
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description="Open WorkPulse visibly, with tracking paused.")
    parser.add_argument("--startup", action="store_true", help="Windows logon launch; opens paused")
    parser.add_argument("--smoke-test", action="store_true", help="Test native dependencies and paused tray, then exit without tracking")
    parser.add_argument("--gui-smoke-test", action="store_true", help="Open the desktop paused, verify it, and exit")
    parser.add_argument("--exercise-gui-error", action="store_true", help="Exercise a sanitized callback error during GUI smoke mode only")
    parser.add_argument("--diagnostics-file", type=Path, help="Write explicit smoke-test results to this file")
    startup_action = parser.add_mutually_exclusive_group()
    startup_action.add_argument("--enable-startup", action="store_true", help="Explicitly register current-user startup; does not start tracking")
    startup_action.add_argument("--disable-startup", action="store_true", help="Remove current-user startup registration; does not start tracking")
    options = parser.parse_args()
    if not getattr(sys, "frozen", False):
        # -I source launches do not depend on PYTHONPATH or the logon directory.
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    if options.enable_startup or options.disable_startup:
        from agent.core.windows_startup import WindowsStartup, StartupError
        from agent.utils.logger import configure_logging, get_logger, shutdown_logging
        configure_logging()
        try:
            startup = WindowsStartup()
            if options.enable_startup:
                startup.enable()
                get_logger().info("startup_enabled")
                if sys.stdout is not None:
                    print("Current-user startup registered. WorkPulse will open visibly PAUSED.", flush=True)
            else:
                startup.remove()
                get_logger().info("startup_removed")
                if sys.stdout is not None:
                    print("Current-user WorkPulse startup entry removed.", flush=True)
            return 0
        except StartupError:
            get_logger().warning("startup_error")
            if sys.stdout is not None:
                print("Startup setting could not be changed. Check the WorkPulse tray settings.", flush=True)
            return 1
        finally:
            shutdown_logging()
    if options.smoke_test:
        from agent.packaging_smoke import run
        return run(diagnostics_file=options.diagnostics_file)
    from agent.ui.desktop import run_desktop
    return run_desktop(diagnostic=options.gui_smoke_test,
                       exercise_error=options.exercise_gui_error and options.gui_smoke_test,
                       diagnostics_file=options.diagnostics_file if options.gui_smoke_test else None)


if __name__ == "__main__":
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from agent.desktop_bootstrap import launch
    raise SystemExit(launch(main))
