"""Visible Windows tray. Run python -m agent.ui.tray; starts paused.

Local tracking only: backend authentication/synchronization are not implemented.
Optional current-user logon launch opens paused; no hidden tracking.
"""
from datetime import datetime, timezone
from queue import Empty, Queue
from threading import Event, Lock, Thread
import webbrowser

import pystray
from PIL import Image, ImageDraw

from ..core.agent import ActivityAgent
from ..config import config
from ..auth.token_store import WindowsTokenStore
from ..core.working_hours import WorkingHoursPolicy
from ..core.windows_startup import WindowsStartup, StartupError
from ..utils.logger import get_logger, configure_logging, shutdown_logging
from ..version import APP_NAME, APP_VERSION, PUBLISHER_DISPLAY_NAME, APP_DESCRIPTION


class TrayState:
    """Shared presentation state; sender must report actual synchronization events."""
    def __init__(self):
        self._lock = Lock()
        self.tracking = "Tracking PAUSED"
        self.sync = "Sync unavailable: backend integration pending"
        self.last_sync = "Never"

    def set_tracking(self, value):
        with self._lock:
            self.tracking = value

    def update_sync(self, *, offline=False, acknowledged_at=None):
        """Call only with real connectivity results and server acknowledgements."""
        if acknowledged_at is not None:
            if not isinstance(acknowledged_at, datetime) or acknowledged_at.tzinfo is None:
                raise ValueError("Synchronization time must be timezone-aware.")
            if acknowledged_at > datetime.now(timezone.utc):
                raise ValueError("Synchronization time cannot be in the future.")
        with self._lock:
            was_offline = self.sync.startswith("Offline")
            self.sync = "Offline: synchronization pending" if offline else "Online"
            if acknowledged_at is not None:
                self.last_sync = acknowledged_at.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
        if offline and not was_offline:
            get_logger().warning("sync_offline")
        if acknowledged_at is not None:
            get_logger().info("sync_succeeded")

    def snapshot(self):
        with self._lock:
            return self.tracking, self.sync, self.last_sync


def tray_image(active=False):
    image = Image.new("RGBA", (64, 64), "#172554")
    draw = ImageDraw.Draw(image)
    draw.line([(9, 15), (19, 46), (32, 25), (43, 46), (54, 15)], fill="white", width=6)
    draw.ellipse((43, 43, 63, 63), fill="#16A34A" if active else "#F59E0B", outline="white", width=2)
    return image


class WorkPulseTray:
    """Tray callbacks enqueue work; listener startup/shutdown runs off the UI thread."""
    def __init__(self, *, agent_factory=ActivityAgent, token_store=None, policy=None, startup=None, open_window=None):
        self.state = TrayState()
        self._factory = agent_factory
        self._tokens = token_store or WindowsTokenStore(config.SERVER_URL)
        self._startup = WindowsStartup() if startup is None else startup
        self._startup_status = "Not checked"
        self._commands = Queue()
        self._closing = Event()
        self.policy = WorkingHoursPolicy() if policy is None else policy
        self._policy_open = self.policy.allows()
        self._requested = False
        self._manual_stop = Event()
        self._manual_stop.set()
        self._control_lock = Lock()
        self._generation = 0
        self._agent = self._runner = self._worker = None
        self._open_window = open_window
        self._view_lock = Lock()
        self._view = {"mouse_movements": 0, "mouse_clicks": 0, "key_presses": 0,
                      "active_app": "Not tracking", "active_seconds": 0.0, "idle_seconds": 0.0}
        item = pystray.MenuItem
        def command(name):
            return lambda *_: self.request(name)
        self.icon = pystray.Icon("WorkPulse", tray_image(), "WorkPulse | Tracking PAUSED",
            menu=pystray.Menu(
                item(f"{APP_NAME} {APP_VERSION}", None, enabled=False),
                item("About WorkPulse Agent", self._show_about),
                item("Open WorkPulse Agent", lambda *_: self._open_window(), enabled=open_window is not None, default=open_window is not None),
                item(lambda _: self.state.snapshot()[0], None, enabled=False),
                item("View tracking status", self._show_status, default=open_window is None),
                item("Open dashboard", command("dashboard")),
                pystray.Menu.SEPARATOR,
                item("Start / restart local tracking", command("start")),
                item("Pause tracking", command("pause")),
                item("EMERGENCY STOP", command("emergency")),
                item(lambda _: self.state.snapshot()[1], None, enabled=False),
                item(lambda _: "Last successful sync: " + self.state.snapshot()[2], None, enabled=False),
                pystray.Menu.SEPARATOR,
                item(lambda _: "Windows startup: " + self._startup_status, None, enabled=False),
                item("Enable Windows auto-start (opens paused)", command("startup_enable")),
                item("Disable / remove Windows startup entry", command("startup_remove")),
                item("Refresh Windows startup status", command("startup_status")),
                pystray.Menu.SEPARATOR,
                item("Logout (local)", command("logout")),
                item("Exit", command("exit")),
            ))

    def desktop_snapshot(self):
        """GUI reads a cached copy; never waits on tracking/OS operations."""
        with self._view_lock:
            result = dict(self._view)
        result["tracking"], result["sync"], result["last_sync"] = self.state.snapshot()
        result["startup"] = self._startup_status
        result["closed"] = self._closing.is_set()
        result["policy_open"] = self._policy_open
        result["tray_visible"] = bool(self.icon.visible)
        return result

    def _cache_metrics(self):
        if self._agent is None:
            return
        summary = self._agent.get_summary()
        values = {"mouse_movements": summary.mouse_movements, "mouse_clicks": summary.mouse_clicks,
                  "key_presses": summary.key_presses, "active_app": summary.active_app or "Unavailable"}
        values.update(self._agent.get_session_durations())
        with self._view_lock:
            self._view.update(values)

    def _show_about(self, *_):
        self.icon.notify(f"{APP_NAME} {APP_VERSION}\n{APP_DESCRIPTION}\nPublisher display name: {PUBLISHER_DISPLAY_NAME}\nUnsigned; publisher identity is not verified.", "About WorkPulse Agent")

    def request(self, command):
        """Emergency/manual stop vetoes queued starts before worker cleanup."""
        with self._control_lock:
            if command in ("start", "pause", "emergency", "logout", "exit"):
                self._generation += 1
            generation = self._generation
            if command in ("pause", "emergency", "logout", "exit"):
                self._manual_stop.set()
                if self._agent is not None:
                    self._agent.stop()  # Event only; never joins on the UI thread.
            self._commands.put((generation, command))

    def _show_status(self, *_):
        tracking, sync, last = self.state.snapshot()
        self.icon.notify(f"{tracking}\n{self.policy.describe()}\n{sync}\nLast successful sync: {last}\nEmergency stop is always in the menu.", "WorkPulse status")

    def _refresh(self):
        active = self._agent is not None and self._agent.is_tracking
        if active:
            self.state.set_tracking("Tracking ON")
        elif self._runner is not None:
            self.state.set_tracking("Tracking starting / stopping" if self._runner.is_alive()
                                    else "Tracking STOPPED: inspect local agent")
        title = "WorkPulse | " + self.state.snapshot()[0]
        if self.icon.title != title:
            self.icon.title = title
            self.icon.icon = tray_image(active)
            self.icon.notify(self.state.snapshot()[0], "WorkPulse tracking status")
            status = self.state.snapshot()[0]
            if status == "Tracking ON":
                get_logger().info("tracking_on")
            elif "outside working hours" in status:
                get_logger().info("tracking_policy_paused")
            elif "explicit restart" in status:
                get_logger().info("tracking_manual_stopped")
            elif status == "Tracking PAUSED":
                get_logger().info("tracking_paused")
        self.icon.update_menu()

    def _pause(self):
        if self._agent is not None:
            self.state.set_tracking("Tracking stopping")
            self._agent.stop()
            self._runner.join()  # Worker only; never blocks the tray loop.
            if self._agent.listeners_running:
                raise RuntimeError("Listener shutdown unconfirmed.")
            if self._open_window is not None:
                self._cache_metrics()
        self._agent = self._runner = None
        self.state.set_tracking("Tracking PAUSED")

    def _handle(self, command):
        generation = None
        if isinstance(command, tuple):
            generation, command = command
            if generation != self._generation:
                return
        if command in ("startup_enable", "startup_remove", "startup_status"):
            # Registry failures do not change tracking state or manual-stop intent.
            try:
                if command == "startup_enable":
                    self._startup.enable()
                    get_logger().info("startup_enabled")
                    self.icon.notify("WorkPulse will open visibly and PAUSED at sign-in. Explicit Start and working-hours checks still apply. Windows startup settings can disable this entry.", "Windows auto-start registered")
                elif command == "startup_remove":
                    self._startup.remove()
                    get_logger().info("startup_removed")
                    self.icon.notify("WorkPulse startup entry removed. Current tracking status is unchanged.", "Windows auto-start disabled")
                self._startup_status = self._startup.status()
            except StartupError as error:
                get_logger().warning("startup_error")
                self._startup_status = "Unable to verify; check Windows startup settings"
                self.icon.notify(str(error), "WorkPulse startup settings")
            self.icon.update_menu()
        elif command == "start" and self._agent is None:
            # Serialize this short local-only startup against an emergency veto.
            # Never perform network/storage calls while holding this lock.
            with self._control_lock:
                if generation is not None and generation != self._generation:
                    return
                # Scheduled starts have no generation: manual stop takes priority.
                if generation is None and self._manual_stop.is_set() and self._requested:
                    return
                if not self.policy.allows():
                    self.state.set_tracking("Tracking PAUSED: outside working hours")
                    self.icon.notify("Outside working hours. Restart explicitly during: " + self.policy.describe(), "WorkPulse")
                    return
                self._manual_stop.clear()
                self._requested = True
                self.state.set_tracking("Tracking starting")
                self._agent = self._factory(policy=self.policy)
                self._runner = Thread(target=self._agent.run, name="WorkPulse tracking")
                self._runner.start()
                with self._view_lock:
                    self._view = {"mouse_movements": 0, "mouse_clicks": 0, "key_presses": 0,
                                  "active_app": "Starting", "active_seconds": 0.0, "idle_seconds": 0.0}
        elif command in ("pause", "emergency", "logout", "exit"):
            self._manual_stop.set()
            self._requested = False
            self._pause()
            if command == "emergency":
                self.state.set_tracking("Tracking STOPPED: explicit restart required")
            if command == "logout":
                self._tokens.clear()
                get_logger().info("local_logout")
                self.icon.notify("Tracking paused; local token removed. Server logout is unavailable until backend integration.", "WorkPulse")
            elif command == "exit":
                self._closing.set()
                self.icon.stop()
        elif command == "dashboard":
            if config.DASHBOARD_URL:
                webbrowser.open(config.DASHBOARD_URL)
            else:
                self.icon.notify("Set DASHBOARD_URL to your WorkPulse web dashboard address.", "Dashboard not configured")

    def _schedule(self):
        if self._manual_stop.is_set() or not self._requested:
            return
        if not self.policy.allows():
            self._pause()
            self.state.set_tracking("Tracking PAUSED: outside working hours")
        elif self._agent is None:
            # This session was explicitly started, then paused only by schedule.
            self._handle("start")
        elif self._runner is not None and not self._runner.is_alive():
            if getattr(self._agent, "pause_reason", None) == "working_hours":
                self._pause()
            else:
                self._requested = False
                self._manual_stop.set()  # Failure must never trigger automatic restart.

    def _work(self):
        while not self._closing.is_set():
            try:
                command = self._commands.get(timeout=0.5)
            except Empty:
                command = None
            try:
                self._handle(command)
                self._policy_open = self.policy.allows()
                self._schedule()
                if self._open_window is not None:
                    self._cache_metrics()
                self._refresh()
            except Exception:
                self._policy_open = False
                get_logger().error("ui_error")
                self._manual_stop.set()
                self._requested = False
                if self._agent is not None:
                    self._agent.stop()
                # Never expose raw backend/native exceptions in notifications.
                self.state.set_tracking("Tracking status requires attention")
                self.icon.title = "WorkPulse | Tracking status requires attention"
                self.icon.icon = tray_image(False)
                self.icon.notify("Action failed. Tracking shutdown may require attention.", "WorkPulse")

    def run(self):
        configure_logging()
        get_logger().info("application_started")
        def setup(icon):
            icon.visible = True
            self._worker = Thread(target=self._work, name="WorkPulse tray controls")
            self._worker.start()
            self.request("startup_status")  # Read only: never re-enable on launch.
            icon.notify("Tracking PAUSED. Explicit Start enables work-hours tracking and scheduled resumption. Manual pause/stop disables resumption. " + self.policy.describe(), "WorkPulse")
        try:
            self.icon.run(setup=setup)
        except Exception:
            get_logger().error("application_error")
            raise
        finally:
            self._commands.put("exit")
            if self._worker is not None:
                self._worker.join()
            get_logger().info("application_stopped")
            shutdown_logging()


if __name__ == "__main__":
    WorkPulseTray().run()
