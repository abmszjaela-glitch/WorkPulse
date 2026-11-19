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
    options = parser.parse_args()
    if not getattr(sys, "frozen", False):
        # -I source launches do not depend on PYTHONPATH or the logon directory.
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    if options.smoke_test:
        from agent.packaging_smoke import run
        return run()
    from agent.ui.tray import WorkPulseTray
    from agent.version import APP_NAME, APP_VERSION
    print(f"{APP_NAME} {APP_VERSION}", flush=True)
    print("WorkPulse opened at Windows sign-in. Tracking PAUSED; explicit Start is required."
          if options.startup else "WorkPulse opening visibly. Tracking PAUSED.", flush=True)
    WorkPulseTray().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
