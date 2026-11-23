"""Compact reference-style screens over the existing desktop controller.

Employee identity is verified by the existing backend, never fabricated locally.
Sign-in alone does not authorize tracking or enable device synchronization.
"""
import tkinter as tk
from tkinter import messagebox

import customtkinter as ctk
from PIL import Image, ImageDraw, ImageTk

from ..version import APP_NAME, APP_VERSION
from .desktop import DesktopApplication
from .login import validate_login_fields

NAVY, BLUE, MUTED = "#172554", "#2563EB", "#64748B"


def short_duration(seconds):
    minutes = max(0, int(seconds)) // 60
    return f"{minutes // 60}h {minutes % 60:02d}m"


class CompactDesktop(DesktopApplication):
    def _build_window(self):
        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")
        self.root.title(f"{APP_NAME} {APP_VERSION} — Paused")
        self.root.geometry("420x790")
        self.root.minsize(400, 590)
        self.root.configure(bg="white")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.report_callback_exception = self._callback_error
        self._consent_accepted = False
        self._compact_vars = []
        self._auth_marker = None
        self._page = "summary"
        self._pages = {}
        icon = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        drawing = ImageDraw.Draw(icon)
        drawing.rounded_rectangle((1, 1, 63, 63), radius=14, fill=BLUE)
        drawing.line(((12, 17), (21, 47), (32, 27), (43, 47), (52, 17)), fill="white", width=6)
        self._window_icon = ImageTk.PhotoImage(icon, master=self.root)
        self.root.iconphoto(True, self._window_icon)
        # The controller's base lifecycle expects these read-only value variables.
        self.values = {key: self._var("0") for key in ("mouse_movements", "mouse_clicks", "key_presses", "active_seconds", "idle_seconds", "active_app")}
        self.status_var, self.sync_var = self._var("Tracking PAUSED"), self._var("Unavailable")
        self.last_sync_var, self.policy_var = self._var("Never"), self._var(self.controller.policy.describe())
        self.feedback = self._var("No input is being collected.")
        self._host = ctk.CTkFrame(self.root, fg_color="white", corner_radius=0)
        self._host.pack(fill="both", expand=True)
        for name in ("summary", "signin", "password", "consent"):
            page = ctk.CTkScrollableFrame(self._host, fg_color="white", corner_radius=0, scrollbar_button_color="#E2E8F0", scrollbar_button_hover_color="#CBD5E1")
            self._pages[name] = page
        self._build_summary(self._pages["summary"])
        self._build_signin(self._pages["signin"])
        self._build_password_change(self._pages["password"])
        self._build_consent(self._pages["consent"])
        self.show_summary()

    def _var(self, value):
        variable = tk.StringVar(master=self.root, value=value)
        self._compact_vars.append(variable)
        return variable

    @staticmethod
    def _text(parent, text=None, *, variable=None, size=13, bold=False, color=NAVY, wrap=342, **kwargs):
        return ctk.CTkLabel(parent, text=text or "", textvariable=variable, text_color=color,
                            font=("Segoe UI", size, "bold" if bold else "normal"), wraplength=wrap,
                            justify=kwargs.pop("justify", "left"), anchor="w", **kwargs)

    @staticmethod
    def _button(parent, text, command, *, secondary=False, danger=False, **kwargs):
        return ctk.CTkButton(parent, text=text, command=command, height=38, corner_radius=8,
                            font=("Segoe UI", 13), fg_color="white" if secondary else BLUE,
                            text_color="#DC2626" if danger else (BLUE if secondary else "white"),
                            border_width=1 if secondary else 0, border_color="#DBEAFE",
                            hover_color="#EFF6FF" if secondary else "#1D4ED8", **kwargs)

    def _brand(self, parent):
        ctk.CTkLabel(parent, text="W", width=28, height=28, corner_radius=8, fg_color=BLUE,
                     text_color="white", font=("Segoe UI", 17, "bold")).pack(side="left")
        self._text(parent, "WorkPulse", size=16, bold=True).pack(side="left", padx=8)

    def _build_summary(self, page):
        content = ctk.CTkFrame(page, fg_color="white", corner_radius=0)
        content.pack(fill="both", expand=True, padx=14, pady=16)
        header = ctk.CTkFrame(content, fg_color="transparent")
        header.pack(fill="x", pady=(0, 12))
        self._brand(header)
        self._badge = self._var("●  Paused")
        self._badge_label = ctk.CTkLabel(header, textvariable=self._badge, width=78, height=27, corner_radius=14,
                                       fg_color="#F1F5F9", text_color=MUTED, font=("Segoe UI", 12))
        self._badge_label.pack(side="right")
        # Native label keeps compatibility with the base status/error update API.
        self.indicator = tk.Label(header, text="", bg="white")
        self._policy_note = self._var("Tracking is paused. Start requires your authorization.")
        box = ctk.CTkFrame(content, corner_radius=8, fg_color="#F8FAFC", border_width=1, border_color="#E2E8F0")
        box.pack(fill="x", pady=(0, 12))
        self._text(box, variable=self._policy_note, size=12, color="#475569", wrap=310).pack(padx=14, pady=12, anchor="w")
        self._account_heading = self._var("Not signed in")
        self._account_note = self._var("Sign in with your registered employee account.")
        self._connection_card = ctk.CTkFrame(content, corner_radius=8, fg_color="#F8FAFC", border_width=1, border_color="#E2E8F0")
        self._connection_card.pack(fill="x", pady=(0, 17))
        self._account_heading_label = self._text(self._connection_card, variable=self._account_heading, size=13, bold=True, color=NAVY)
        self._account_heading_label.pack(anchor="w", padx=14, pady=(10, 0))
        self._account_note_label = self._text(self._connection_card, variable=self._account_note, size=12, color=MUTED, wrap=310)
        self._account_note_label.pack(anchor="w", padx=14, pady=(2, 12))
        self._heading = self._var("Session paused")
        self._text(content, variable=self._heading, size=18, bold=True).pack(anchor="w")
        self._text(content, "Summary of this local session.", size=12, color=MUTED).pack(anchor="w", pady=(0, 12))
        cards = ctk.CTkFrame(content, fg_color="transparent")
        cards.pack(fill="x", pady=(0, 12))
        self._duration_vars = {}
        for col, (key, label, background, color) in enumerate((("total", "TOTAL", "#F8FAFC", NAVY), ("active", "ACTIVE", "#F0FDF4", "#16A34A"), ("idle", "IDLE", "#FFFBEB", "#D97706"))):
            cards.grid_columnconfigure(col, weight=1, uniform="summary")
            card = ctk.CTkFrame(cards, corner_radius=8, fg_color=background, border_width=1, border_color="#E2E8F0" if col == 0 else ("#DCFCE7" if col == 1 else "#FEF3C7"))
            card.grid(row=0, column=col, sticky="nsew", padx=(0 if col == 0 else 8, 0))
            self._text(card, label, size=10, color=MUTED if col == 0 else color).pack(pady=(9, 0))
            variable = self._var("0h 00m")
            self._duration_vars[key] = variable
            self._text(card, variable=variable, size=19, bold=True, color=color).pack(pady=(2, 11))
        activity = ctk.CTkFrame(content, corner_radius=8, fg_color="#F8FAFC", border_width=1, border_color="#E2E8F0")
        activity.pack(fill="x", pady=(0, 12))
        for key, title in (("mouse_movements", "Mouse movement events"), ("mouse_clicks", "Mouse clicks"), ("active_app", "Current application")):
            row = ctk.CTkFrame(activity, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=6)
            row.grid_columnconfigure(1, weight=1)
            self._text(row, title, size=12, color=MUTED, wrap=155).grid(row=0, column=0, sticky="w", padx=(0, 10))
            self._text(row, variable=self.values[key], size=12, bold=True, wrap=165).grid(row=0, column=1, sticky="e")
        controls = ctk.CTkFrame(content, fg_color="transparent")
        controls.pack(fill="x", pady=(0, 8))
        self.start_button = self._button(controls, "Start / resume", self.start_tracking, width=130)
        self.start_button.pack(side="left")
        self._button(controls, "Pause", self.pause, secondary=True, width=62).pack(side="left", padx=6)
        self._button(controls, "Emergency stop", self.emergency_stop, secondary=True, danger=True, width=125).pack(side="right")
        self._button(content, "Sign out", self._sign_out, secondary=True, danger=True).pack(fill="x", pady=(0, 4))
        links = ctk.CTkFrame(content, fg_color="transparent")
        links.pack(fill="x")
        ctk.CTkButton(links, text="Sign in", command=self._open_signin, fg_color="transparent", text_color=BLUE, hover_color="#EFF6FF", width=80, height=25).pack(side="left")
        ctk.CTkButton(links, text="Details", command=self._show_details, fg_color="transparent", text_color=BLUE, hover_color="#EFF6FF", width=80, height=25).pack(side="left")
        ctk.CTkButton(links, text="Privacy notice", command=lambda: self._show_page("consent"), fg_color="transparent", text_color=BLUE, hover_color="#EFF6FF", width=120, height=25).pack(side="right")

    def _build_signin(self, page):
        content = ctk.CTkFrame(page, fg_color="white")
        content.pack(fill="both", expand=True, padx=14, pady=20)
        ctk.CTkLabel(content, text="W", width=48, height=48, corner_radius=13, fg_color=BLUE, text_color="white", font=("Segoe UI", 28, "bold")).pack(pady=(0, 8))
        self._text(content, "WorkPulse  ·  Agent", size=18, bold=True).pack()
        self._text(content, "Sign in", size=18, bold=True).pack(pady=(12, 0))
        self._text(content, "Use the account your administrator created for you.", size=13, color=MUTED, wrap=310, justify="center").pack(pady=(2, 20))
        self._email, self._password = self._var(""), self._var("")
        self._text(content, "Email address", size=12, bold=True).pack(anchor="w")
        self.email_entry = ctk.CTkEntry(content, textvariable=self._email, placeholder_text="you@company.com", height=38, corner_radius=7, fg_color="white", border_color="#DBEAFE", text_color=NAVY)
        self.email_entry.pack(fill="x", pady=(5, 14))
        self._text(content, "Password", size=12, bold=True).pack(anchor="w")
        self.password_entry = ctk.CTkEntry(content, textvariable=self._password, show="●", height=38, corner_radius=7, fg_color="white", border_color="#DBEAFE", text_color=NAVY)
        self.password_entry.pack(fill="x", pady=(5, 8))
        self._auth_message = self._var("Sign in with your registered employee account.")
        self._text(content, variable=self._auth_message, size=12, color="#B45309", wrap=330).pack(anchor="w", pady=(0, 12))
        self.signin_button = self._button(content, "Sign In", self._submit_login)
        self.signin_button.pack(fill="x", pady=(0, 15))
        self.password_entry.bind("<Return>", self._submit_login)
        self._text(content, "Forgot password? Contact your administrator", size=12, color=BLUE, wrap=330).pack(pady=(0, 18))
        note = ctk.CTkFrame(content, corner_radius=8, fg_color="#EFF6FF", border_width=1, border_color="#DBEAFE")
        note.pack(fill="x")
        self._text(note, "Tracking requires explicit consent and applicable authorization. This screen never starts tracking.", size=12, color="#1D4ED8", wrap=310).pack(padx=12, pady=12)
        self._button(content, "Back to session", self.show_summary, secondary=True).pack(fill="x", pady=(16, 0))

    def _build_password_change(self, page):
        content = ctk.CTkFrame(page, fg_color="white")
        content.pack(fill="both", expand=True, padx=14, pady=20)
        brand = ctk.CTkFrame(content, fg_color="transparent")
        brand.pack(fill="x", pady=(0, 18))
        self._brand(brand)
        self._text(content, "Change temporary password", size=19, bold=True).pack(anchor="w")
        self._text(content, "Your administrator created this account with a temporary password. Choose your own password before continuing.", color=MUTED).pack(anchor="w", pady=(6, 18))
        self._current_password, self._new_password, self._confirm_password = self._var(""), self._var(""), self._var("")
        self._password_entries = []
        for label, variable in (("Current temporary password", self._current_password), ("New password", self._new_password), ("Confirm new password", self._confirm_password)):
            self._text(content, label, size=12, bold=True).pack(anchor="w")
            entry = ctk.CTkEntry(content, textvariable=variable, show="●", height=38, corner_radius=7, fg_color="white", border_color="#DBEAFE", text_color=NAVY)
            entry.pack(fill="x", pady=(5, 14))
            self._password_entries.append(entry)
        self._password_entries[-1].bind("<Return>", self._submit_password_change)
        self._text(content, "At least 12 characters; uppercase, lowercase, a number and a symbol. Maximum 72 UTF-8 bytes.", size=12, color=MUTED).pack(anchor="w", pady=(0, 12))
        self._change_message = self._var("")
        self._text(content, variable=self._change_message, size=12, color="#B45309").pack(anchor="w", pady=(0, 12))
        self.change_password_button = self._button(content, "Update password", self._submit_password_change)
        self.change_password_button.pack(fill="x")
        self._button(content, "Sign out", self._sign_out, secondary=True).pack(fill="x", pady=(12, 0))

    def _open_signin(self):
        self.pause()
        auth = self.controller.desktop_snapshot().get("auth", {})
        self._show_page("password" if auth.get("state") == "password_required" else "signin")

    def _submit_login(self, _event=None):
        auth = self.controller.desktop_snapshot().get("auth", {})
        if auth.get("state") in ("signing_in", "checking_session", "changing_password", "signed_in"):
            return
        email, password = self._email.get().strip(), self._password.get()
        error = validate_login_fields(email, password)
        if error:
            self._auth_message.set(error)
            return
        self._password.set("")
        try:
            self.controller.request_auth("login", email, password)
            self.signin_button.configure(state="disabled")
            self._auth_message.set("Signing in…")
        finally:
            del password

    def _submit_password_change(self, _event=None):
        auth = self.controller.desktop_snapshot().get("auth", {})
        if auth.get("state") != "password_required":
            return
        current, new, confirm = self._current_password.get(), self._new_password.get(), self._confirm_password.get()
        if not current:
            self._change_message.set("Enter your current temporary password.")
            return
        if new != confirm:
            self._change_message.set("New passwords do not match.")
            return
        if (len(new) < 12 or len(new.encode("utf-8")) > 72 or not any(c.isupper() for c in new)
                or not any(c.islower() for c in new) or not any(c.isdigit() for c in new)
                or not any(not c.isalnum() for c in new) or new == current):
            self._change_message.set("Choose a different password meeting all the requirements above.")
            return
        self._clear_password_fields()
        self.controller.request_auth("change_password", current, new)
        self.change_password_button.configure(state="disabled")
        self._change_message.set("Updating password…")
        del current, new, confirm

    def _clear_password_fields(self):
        for name in ("_password", "_current_password", "_new_password", "_confirm_password"):
            variable = getattr(self, name, None)
            if variable is not None:
                variable.set("")

    def _render_auth(self, auth):
        marker = (auth.get("revision"), auth.get("state"), auth.get("message"))
        if marker == self._auth_marker:
            return
        self._auth_marker = marker
        state = auth.get("state", "signed_out")
        busy = state in ("signing_in", "checking_session", "changing_password")
        enabled = not busy and state == "signed_out"
        self.signin_button.configure(state="normal" if enabled else "disabled", text="Signing in…" if busy else "Sign In")
        self.email_entry.configure(state="normal" if enabled else "disabled")
        self.password_entry.configure(state="normal" if enabled else "disabled")
        self.change_password_button.configure(state="normal" if state == "password_required" else "disabled")
        for entry in self._password_entries:
            entry.configure(state="disabled" if busy else "normal")
        message = auth.get("message", "Sign in with your registered employee account.")
        self._auth_message.set(message)
        self._change_message.set(message)
        if state == "password_required":
            self._show_page("password")
        elif state == "signed_in" and self._page in ("signin", "password"):
            self.show_summary()
        elif state == "signed_out" and self._page == "password":
            self._show_page("signin")

    def _build_consent(self, page):
        content = ctk.CTkFrame(page, fg_color="white")
        content.pack(fill="both", expand=True, padx=14, pady=16)
        brand = ctk.CTkFrame(content, fg_color="transparent")
        brand.pack(fill="x", pady=(0, 16))
        self._brand(brand)
        self._text(content, "Before we start", size=19, bold=True).pack(anchor="w")
        self._text(content, "Understand exactly what WorkPulse records before authorizing a local session.", color=MUTED, wrap=335).pack(anchor="w", pady=(3, 18))
        for heading, rows, background, color, border in (
            ("●  RECORDED", ("✓  Mouse and keyboard activity counts", "✓  Active and idle time", "✓  Application names and usage duration"), "#F0FDF4", "#16A34A", "#DCFCE7"),
            ("●  NEVER RECORDED", ("×  What you type, including passwords", "×  Screenshots or screen content", "×  Files, emails, chats or browsing content"), "#FEF2F2", "#DC2626", "#FEE2E2")):
            box = ctk.CTkFrame(content, corner_radius=8, fg_color=background, border_width=1, border_color=border)
            box.pack(fill="x", pady=(0, 14))
            self._text(box, heading, size=12, bold=True, color=color).pack(anchor="w", padx=14, pady=(12, 4))
            for row in rows:
                self._text(box, row, size=12, color=color, wrap=310).pack(anchor="w", padx=14, pady=3)
            ctk.CTkFrame(box, height=8, fg_color="transparent").pack()
        self._button(content, "I agree and continue", self._accept_consent).pack(fill="x", pady=(8, 8))
        self._button(content, "Read privacy policy", self.show_privacy, secondary=True).pack(fill="x")
        self._text(content, f"WorkPulse Agent {APP_VERSION} · Transparent activity tracking", size=10, color=MUTED, wrap=335).pack(pady=(16, 0))
        self._text(content, "Consent alone does not start tracking or sign you in.", size=11, color=MUTED, wrap=335).pack()

    def _show_page(self, page):
        self._clear_password_fields()
        for frame in self._pages.values():
            frame.pack_forget()
        self._pages[page].pack(fill="both", expand=True)
        self._page = page
        self.root.title(f"{APP_NAME} {APP_VERSION} — " + {"summary": "Paused", "signin": "Sign In", "password": "Change Password", "consent": "Setup"}[page])

    def show_summary(self):
        self._show_page("summary")

    def _accept_consent(self):
        self._consent_accepted = True
        self.show_summary()
        self.feedback.set("Privacy notice accepted. Start the session explicitly when authorized.")

    def start_tracking(self):
        if self.controller.desktop_snapshot().get("auth", {}).get("state") in ("password_required", "changing_password"):
            self._show_page("password")
            return
        if not self._consent_accepted:
            self._show_page("consent")
            return
        super().start_tracking()

    def _sign_out(self):
        self.controller.request("logout")
        self._consent_accepted = False
        self._email.set("")
        self._show_page("signin")

    def show_privacy(self):
        messagebox.showinfo("WorkPulse privacy policy", "Recorded: aggregate mouse/key activity counts, active/idle time, application names and durations.\n\nNever recorded: key contents, passwords, screenshots, window titles, document names or browsing content.\n\nTracking requires explicit authorization and working-hours policy checks. Manual stop disables automatic restart.\n\nSign-in uses the WorkPulse backend. Access tokens are kept in Windows Credential Manager; passwords are never saved. Device synchronization is not connected by sign-in. No offline saving/upload promise is made by this UI. Uninstall retains local employee data.", parent=self.root)

    def _show_details(self):
        view = self._last_view
        messagebox.showinfo("Activity details", f"Mouse movement events: {view['mouse_movements']}\nMouse clicks: {view['mouse_clicks']}\nAnonymous key presses: {view['key_presses']}\nForeground application: {view['active_app']}\n\nSynchronization: {view['sync']}\nLast successful synchronization: {view['last_sync']}\n\nEmployee sign-in and device synchronization are separate. Device-authenticated uploads are not connected in this build.\n\n{self.controller.policy.describe()}", parent=self.root)

    def _render_account(self, auth):
        """Login success is independent of device connectivity/acknowledgement."""
        if auth.get("signed_in"):
            self._account_heading.set("Signed in successfully")
            self._account_note.set(auth["email"])
            background, border, color = "#F0FDF4", "#BBF7D0", "#15803D"
        elif auth.get("state") in ("password_required", "changing_password"):
            self._account_heading.set("Password change required")
            self._account_note.set(auth.get("message", ""))
            background, border, color = "#FFFBEB", "#FDE68A", "#B45309"
        elif auth.get("state") in ("checking_session", "signing_in"):
            self._account_heading.set("Verifying employee account…")
            self._account_note.set(auth.get("message", ""))
            background, border, color = "#EFF6FF", "#DBEAFE", "#1D4ED8"
        else:
            self._account_heading.set("Not signed in")
            self._account_note.set(auth.get("message", "Sign in with your registered employee account."))
            background, border, color = "#F8FAFC", "#E2E8F0", MUTED
        self._connection_card.configure(fg_color=background, border_color=border)
        self._account_heading_label.configure(text_color=color)
        self._account_note_label.configure(text_color=color)

    def _poll(self):
        super()._poll()
        if self._closing:
            return
        view = self._last_view
        auth = view.get("auth", {})
        self._render_auth(auth)
        active = view["tracking"] == "Tracking ON" and not self._error_message
        idle = active and view.get("activity_status") == "IDLE"
        state = "Idle" if idle else ("Tracking ON" if active else "Paused")
        self._badge.set("●  " + state)
        self._badge_label.configure(text_color="#D97706" if idle else ("#16A34A" if active else MUTED), fg_color="#FFFBEB" if idle else ("#F0FDF4" if active else "#F1F5F9"))
        self._heading.set("Tracking in progress" if active else "Session paused")
        self._duration_vars["total"].set(short_duration(view["active_seconds"] + view["idle_seconds"]))
        self._duration_vars["active"].set(short_duration(view["active_seconds"]))
        self._duration_vars["idle"].set(short_duration(view["idle_seconds"]))
        self._render_account(auth)
        self._policy_note.set("Tracking is paused outside your working hours. " + ("Your authorized session resumes automatically." if view.get("automatic_resume") else "Start explicitly during working hours.") if not view["policy_open"] else ("Tracking is active under your authorization. You can stop at any time." if active else "Tracking is paused. Starting requires your authorization."))
        if self._error_message:
            self._policy_note.set(self._error_message)
        if self._page == "summary":
            self.root.title(f"{APP_NAME} {APP_VERSION} — {state}")

    def dispose(self):
        self._clear_password_fields()
        self._compact_vars.clear()
        super().dispose()
        self._duration_vars.clear()
        self._pages.clear()
        for name, value in list(vars(self).items()):
            if name != "root" and isinstance(value, (tk.Variable, tk.Widget, ImageTk.PhotoImage)):
                setattr(self, name, None)
