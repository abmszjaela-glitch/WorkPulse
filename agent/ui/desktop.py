"""Native Tk desktop view over the existing tray/agent control worker."""
import json
from pathlib import Path
from queue import Empty, Queue
from threading import Thread
import threading
import tkinter as tk
from tkinter import messagebox, ttk

from ..core.agent import ActivityAgent
from ..utils.logger import configure_logging, get_logger, logging_available
from ..version import APP_NAME, APP_VERSION
from .tray import WorkPulseTray


def duration_text(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"


class DesktopApplication:
    """Tk only on main thread; queues/cached snapshots bridge the tray worker.

    Close exits and stops tracking. Normal Windows minimize retains a taskbar
    window; no withdraw-to-tray feature relies on an overflow-hidden icon.
    """
    def __init__(self, root, *, controller=None, diagnostic=False, exercise_error=False):
        self.root = root
        self._events = Queue()
        self.controller = controller or WorkPulseTray(
            agent_factory=lambda **kwargs: ActivityAgent(output=lambda _message: None, **kwargs),
            open_window=lambda: self._events.put("open"),
            show_summary=lambda: self._events.put("summary"),
            privacy_policy=lambda: self._events.put("privacy"))
        self.diagnostic = diagnostic
        self._exercise_error = exercise_error
        self._callback_error_seen = False
        self._closing = False
        self._tray_ready = False
        self._was_visible = False
        self._error_message = ""
        self._last_view = self.controller.desktop_snapshot()
        self._thread = None
        self._poll_id = None
        self._build_window()

    def _build_window(self):
        root = self.root
        self.root.title(f"{APP_NAME} {APP_VERSION}")
        self.root.geometry("980x760")
        self.root.minsize(850, 710)
        self.root.configure(bg="#EFF6FF")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.report_callback_exception = self._callback_error
        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure("Primary.TButton", background="#2563EB", foreground="white", padding=(16, 11), font=("Segoe UI", 10, "bold"))
        style.map("Primary.TButton", background=[("active", "#1D4ED8"), ("disabled", "#CBD5E1")])
        style.configure("Action.TButton", padding=(14, 11), font=("Segoe UI", 10))
        style.configure("Danger.TButton", background="#DC2626", foreground="white", padding=(16, 11), font=("Segoe UI", 10, "bold"))
        header = tk.Frame(root, bg="#172554", padx=28, pady=20)
        header.pack(fill="x")
        tk.Label(header, text=f"{APP_NAME} {APP_VERSION}", bg="#172554", fg="white", font=("Segoe UI", 22, "bold")).pack(anchor="w")
        tk.Label(header, text="Your activity, visible and under your control", bg="#172554", fg="#BFDBFE", font=("Segoe UI", 10)).pack(anchor="w", pady=(5, 0))
        content = tk.Frame(root, bg="#EFF6FF")
        content.pack(fill="both", expand=True)
        canvas = tk.Canvas(content, bg="#EFF6FF", highlightthickness=0)
        scrollbar = ttk.Scrollbar(content, orient="vertical", command=canvas.yview)
        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        canvas.configure(yscrollcommand=scrollbar.set)
        body = tk.Frame(canvas, bg="#EFF6FF", padx=26, pady=18)
        content_window = canvas.create_window((0, 0), window=body, anchor="nw")
        body.bind("<Configure>", lambda _event: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda event: canvas.itemconfigure(content_window, width=event.width))
        canvas.bind_all("<MouseWheel>", lambda event: canvas.yview_scroll(-int(event.delta / 120), "units"))
        status = tk.Frame(body, bg="white", padx=18, pady=14)
        status.pack(fill="x")
        self.indicator = tk.Label(status, text="●", bg="white", fg="#F59E0B", font=("Segoe UI", 26))
        self.indicator.pack(side="left", padx=(0, 12))
        self.status_var = tk.StringVar(value="Tracking PAUSED")
        tk.Label(status, textvariable=self.status_var, bg="white", fg="#172554", font=("Segoe UI", 17, "bold")).pack(side="left")
        ttk.Button(status, text="EMERGENCY STOP", style="Danger.TButton", command=self.emergency_stop).pack(side="right")
        account = tk.Frame(body, bg="white", padx=18, pady=12)
        account.pack(fill="x", pady=(12, 0))
        tk.Label(account, text="EMPLOYEE SESSION  •  LOCAL MODE", bg="white", fg="#64748B", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(account, text="Not signed in — backend authentication unavailable", bg="white", fg="#172554", font=("Segoe UI", 11)).pack(anchor="w", pady=(5, 0))
        tk.Label(account, text="No verified employee session is claimed. Local tracking requires your explicit authorization.", bg="white", fg="#64748B", font=("Segoe UI", 9)).pack(anchor="w", pady=(3, 0))
        metrics = tk.Frame(body, bg="#EFF6FF")
        metrics.pack(fill="x", pady=(14, 0))
        self.values = {}
        for index, (key, title) in enumerate((("mouse_movements", "Mouse activity"), ("mouse_clicks", "Mouse clicks"), ("key_presses", "Anonymous key presses"), ("active_seconds", "Active duration"), ("idle_seconds", "Idle duration"), ("active_app", "Foreground application"))):
            row, column = divmod(index, 3)
            metrics.columnconfigure(column, weight=1, uniform="cards")
            card = tk.Frame(metrics, bg="white", padx=16, pady=13)
            card.grid(row=row, column=column, sticky="nsew", padx=(0 if column == 0 else 7, 0), pady=(0, 8))
            tk.Label(card, text=title, bg="white", fg="#64748B", font=("Segoe UI", 9)).pack(anchor="w")
            variable = tk.StringVar(value="Not tracking" if key == "active_app" else ("00:00:00" if key.endswith("seconds") else "0"))
            self.values[key] = variable
            tk.Label(card, textvariable=variable, bg="white", fg="#172554", font=("Segoe UI", 13 if key == "active_app" else 22, "bold"), wraplength=215, justify="left").pack(anchor="w", pady=(6, 0))
        sync = tk.Frame(body, bg="white", padx=18, pady=12)
        sync.pack(fill="x", pady=(5, 0))
        self.sync_var = tk.StringVar(value="Synchronization unavailable — backend integration pending")
        self.last_sync_var = tk.StringVar(value="Last successful synchronization: Never")
        for var in (self.sync_var, self.last_sync_var):
            tk.Label(sync, textvariable=var, bg="white", fg="#475569", font=("Segoe UI", 10)).pack(anchor="w", pady=2)
        actions = tk.Frame(body, bg="#EFF6FF")
        actions.pack(fill="x", pady=(14, 0))
        self.start_button = ttk.Button(actions, text="Start / Resume local tracking", style="Primary.TButton", command=self.start_tracking)
        self.start_button.pack(side="left")
        ttk.Button(actions, text="Pause", style="Action.TButton", command=self.pause).pack(side="left", padx=8)
        ttk.Button(actions, text="Open dashboard", style="Action.TButton", command=lambda: self.controller.request("dashboard")).pack(side="right")
        self.policy_var = tk.StringVar(value="Working hours: " + self.controller.policy.describe())
        tk.Label(body, textvariable=self.policy_var, bg="#EFF6FF", fg="#475569", font=("Segoe UI", 9)).pack(anchor="w", pady=(12, 4))
        self.feedback = tk.StringVar(value="Tracking is paused. No input is being collected.")
        tk.Label(body, textvariable=self.feedback, bg="#EFF6FF", fg="#172554", font=("Segoe UI", 9), wraplength=900, justify="left").pack(anchor="w")
        tk.Label(body, text="Only aggregate counts and application names/durations. No key contents, screenshots or window titles.\nCounts refer to the current local session; restarting begins a new session. Closing stops tracking and exits.", bg="#EFF6FF", fg="#64748B", font=("Segoe UI", 9), justify="left", wraplength=900).pack(anchor="w", pady=(12, 0))

    def _tray_run(self):
        try:
            self.controller.run()
        except Exception:
            from ..desktop_bootstrap import record_failure
            record_failure("desktop_thread_error")
            self.controller.request("emergency")
            self._events.put("error")

    def start_tracking(self):
        if self._closing or self._error_message:
            return
        auth = self.controller.desktop_snapshot().get("auth", {})
        if auth.get("state") in ("password_required", "changing_password", "signing_in", "checking_session"):
            self.feedback.set("Complete employee authentication before authorizing tracking.")
            return
        identity = "You are signed in to your employee account." if auth.get("signed_in") else "You are not signed in to a backend employee session."
        if messagebox.askyesno("Authorize local tracking", identity + "\n\nAuthorize this local session to count mouse/key events and application usage during configured working hours?\n\nNo typed text, screenshots or window titles are collected. You can pause or stop at any time. Device synchronization is not enabled by sign-in.", parent=self.root):
            self.feedback.set("Local session explicitly authorized; checking working-hours policy.")
            self.controller.request("start")

    def pause(self):
        self.controller.request("pause")
        self.feedback.set("Pause requested. Explicit Start / Resume is required to restart.")

    def emergency_stop(self):
        self.controller.request("emergency")
        self.feedback.set("Emergency stop requested. No automatic restart is authorized.")

    def _callback_error(self, _type, _value, _traceback):
        from ..desktop_bootstrap import record_failure
        record_failure("desktop_callback_error")
        self._callback_error_seen = True
        self.emergency_stop()
        self._error_message = "A desktop action failed. Tracking was stopped; review logs and restart explicitly."
        self.feedback.set(self._error_message)
        self.status_var.set("Tracking STOP requested — attention required")
        self.indicator.configure(fg="#DC2626")
        if self._poll_id is not None:
            self.root.after_cancel(self._poll_id)
        self._poll_id = self.root.after(500, self._poll)

    def _poll(self):
        self._poll_id = None
        try:
            while True:
                event = self._events.get_nowait()
                if event in ("open", "summary", "privacy"):
                    self.root.deiconify()
                    self.root.lift()
                    callback = getattr(self, "show_summary" if event != "privacy" else "show_privacy", None)
                    if callback is not None:
                        callback()
                else:
                    self.emergency_stop()
                    self._error_message = "Background control failed. Tracking stopped; review logs."
        except Empty:
            pass
        view = self.controller.desktop_snapshot()
        self._last_view = view
        self._tray_ready = self._tray_ready or view["tray_visible"]
        self._was_visible = self._was_visible or bool(self.root.winfo_viewable())
        self.status_var.set("Tracking STOP requested — attention required" if self._error_message else view["tracking"])
        self.indicator.configure(fg="#DC2626" if self._error_message else ("#16A34A" if view["tracking"] == "Tracking ON" else "#F59E0B"))
        for key, variable in self.values.items():
            value = view[key]
            variable.set(duration_text(value) if key.endswith("seconds") else str(value))
        self.sync_var.set(view["sync"])
        self.last_sync_var.set("Last successful synchronization: " + view["last_sync"])
        self.start_button.configure(state="disabled" if self._closing or not view["policy_open"] or view["tracking"] == "Tracking ON" or self._error_message else "normal")
        if not self._closing and not self._error_message and not view["policy_open"]:
            self.feedback.set("Outside configured working hours. No local tracking can be started.")
        if self._error_message:
            self.feedback.set(self._error_message)
        if not logging_available() and not self._closing:
            self.emergency_stop()
            self._error_message = "File logging is unavailable. Tracking stopped. Fix log permissions/storage and restart."
        if view["closed"] and not self._closing:
            self.close()
        if self._closing and (self._thread is None or not self._thread.is_alive()):
            self.root.destroy()
            return
        self._poll_id = self.root.after(500, self._poll)

    def close(self):
        if not self._closing:
            self._closing = True
            self.feedback.set("Stopping listeners and closing WorkPulse…")
            self.controller.request("exit")

    def _test_error(self):
        raise RuntimeError("fabricated-private-error-must-not-be-logged")

    def dispose(self):
        """Release Tk references on the UI thread, never in a worker GC pass."""
        self.root.report_callback_exception = lambda *_: None
        try:
            for identifier in self.root.tk.call("after", "info"):
                self.root.after_cancel(identifier)
        except tk.TclError:
            pass
        self.values.clear()
        for name in ("status_var", "sync_var", "last_sync_var", "policy_var", "feedback"):
            setattr(self, name, None)

    def run(self):
        if not configure_logging():
            raise RuntimeError("Desktop startup requires available error logging.")
        get_logger().info("desktop_started")
        self._thread = Thread(target=self._tray_run, name="WorkPulse visible tray")
        self._thread.start()
        if not self.diagnostic and hasattr(self.controller, "request_auth"):
            self.controller.request_auth("restore")
        previous_thread_hook = threading.excepthook
        def worker_error(_args):
            from ..desktop_bootstrap import record_failure
            record_failure("desktop_thread_error")
            self.controller.request("emergency")
            self._events.put("error")
        threading.excepthook = worker_error
        self._poll_id = self.root.after(100, self._poll)
        if self.diagnostic:
            if self._exercise_error:
                self.root.after(700, self._test_error)
            self.root.after(2000, self.close)
        try:
            self.root.mainloop()
        finally:
            self.controller.request("exit")
            self._thread.join(timeout=20)
            threading.excepthook = previous_thread_hook
        return {"window_title": f"{APP_NAME} {APP_VERSION}", "window_was_visible": self._was_visible,
                "tray_was_visible": self._tray_ready, "tracking_never_started": self.controller._agent is None and not self.controller._requested,
                "callback_error_seen": self._callback_error_seen, "tracking": self._last_view["tracking"],
                "employee_status": self.controller.desktop_snapshot().get("auth", {}).get("state", "signed_out")}


def run_desktop(*, diagnostic=False, exercise_error=False, diagnostics_file=None):
    from .compact import CompactDesktop
    root = tk.Tk()
    application = CompactDesktop(root, diagnostic=diagnostic, exercise_error=exercise_error)
    try:
        result = application.run()
    finally:
        application.dispose()
        try:
            root.destroy()
        except tk.TclError:
            pass
    if diagnostics_file:
        Path(diagnostics_file).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return 0
