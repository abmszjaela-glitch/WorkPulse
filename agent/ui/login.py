"""Login view only; no guessed API routes or client-side authentication bypass.

A controller must supply on_login and use the real backend contract to verify
authentication. Without a controller, credentials cannot be submitted. Successful
authentication should close/replace this view; this view never starts tracking.
"""

from collections.abc import Callable
import tkinter as tk
from tkinter import ttk


def validate_login_fields(email: str, password: str) -> str | None:
    """Basic empty-field feedback; the backend remains the credential authority."""
    if not email.strip():
        return "Enter your registered email address."
    if not password:
        return "Enter your password."
    return None


class LoginForm(ttk.Frame):
    """A thin masked form for a real authentication controller.

    on_login is called on the UI thread. A network controller should dispatch its
    request off-thread and marshal results back with Tk.after(), calling
    show_error() on failure or closing the form only after verified success.
    No credentials are written, logged or included in exception messages here.
    """

    def __init__(
        self, parent, *, on_login: Callable[[str, str], None] | None = None
    ) -> None:
        super().__init__(parent, padding=28)
        self._on_login = on_login
        self._busy = False
        self._email = tk.StringVar()
        self._password = tk.StringVar()
        self._status = tk.StringVar()
        self.columnconfigure(0, weight=1)
        ttk.Label(self, text="WorkPulse Agent", font=("Segoe UI", 18, "bold")).grid(
            row=0, column=0, sticky="w", pady=(0, 6)
        )
        ttk.Label(self, text="Sign in with your registered employee account.", wraplength=340).grid(
            row=1, column=0, sticky="w", pady=(0, 20)
        )
        ttk.Label(self, text="Email address").grid(row=2, column=0, sticky="w")
        self.email_entry = ttk.Entry(self, textvariable=self._email)
        self.email_entry.grid(row=3, column=0, sticky="ew", pady=(5, 14))
        ttk.Label(self, text="Password").grid(row=4, column=0, sticky="w")
        self.password_entry = ttk.Entry(self, textvariable=self._password, show="*")
        self.password_entry.grid(row=5, column=0, sticky="ew", pady=(5, 14))
        self.submit_button = ttk.Button(self, text="Sign In", command=self._submit)
        self.submit_button.grid(row=6, column=0, sticky="ew")
        ttk.Label(self, textvariable=self._status, wraplength=340).grid(
            row=7, column=0, sticky="w", pady=(12, 8)
        )
        ttk.Label(self, text="Passwords are never saved. This screen does not start tracking.",
                  wraplength=340).grid(row=8, column=0, sticky="w")
        self.password_entry.bind("<Return>", self._submit)
        if on_login is None:
            self._status.set("Backend authentication is not configured. Sign-in is unavailable.")
            for widget in (self.email_entry, self.password_entry, self.submit_button):
                widget.state(["disabled"])

    def _submit(self, _event=None) -> None:
        if self._busy or self._on_login is None:
            return
        email, password = self._email.get().strip(), self._password.get()
        error = validate_login_fields(email, password)
        if error:
            self._status.set(error)
            return
        self._password.set("")
        self._busy = True
        self.submit_button.state(["disabled"])
        self._status.set("Signing in…")
        try:
            self._on_login(email, password)
        except Exception:
            # Never allow Tk's default callback error reporter to print a backend
            # exception that could contain request bodies or token responses.
            self.show_error("unexpected")
        finally:
            del password

    def show_error(self, reason: str) -> None:
        """Display sanitized categories, never raw server bodies or exceptions."""
        messages = {
            "invalid_credentials": "Invalid email or password.",
            "network": "Unable to reach WorkPulse. Check your connection and try again.",
            "expired": "Your session expired. Sign in again.",
            "unavailable": "Backend authentication is not configured. Sign-in is unavailable.",
            "unexpected": "Sign-in could not be completed. Please try again.",
        }
        self._password.set("")
        self._busy = False
        self._status.set(messages.get(reason, messages["unexpected"]))
        if self._on_login is not None:
            self.submit_button.state(["!disabled"])

    def destroy(self) -> None:
        self._password.set("")
        super().destroy()


def main() -> None:
    """Preview only: no authentication adapter or tracking is enabled."""
    root = tk.Tk()
    root.title("WorkPulse Agent — Sign In")
    root.minsize(420, 400)
    LoginForm(root).pack(fill="both", expand=True)
    root.mainloop()


if __name__ == "__main__":
    main()
