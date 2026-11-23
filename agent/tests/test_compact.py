"""Reference-screen behavior with fake controls, never real activity input."""
from datetime import datetime, time, timezone
import gc
import tkinter as tk
import unittest
from unittest.mock import patch, Mock

from agent.core.working_hours import WorkingHoursPolicy
from agent.ui.compact import CompactDesktop, short_duration
from test_desktop import FakeController


class CompactTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.controller = FakeController()
        self.controller.request_auth = Mock()
        self.controller.view["auth"] = {"state": "signed_out", "signed_in": False, "email": "", "revision": 0, "message": "Sign in with your registered employee account."}
        self.controller.policy = WorkingHoursPolicy(zone="UTC", days=range(7))
        self.app = CompactDesktop(self.root, controller=self.controller)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.app.dispose()
        self.root.destroy()
        self.app = self.root = None
        gc.collect()

    def test_main_reference_summary_is_first_and_never_starts_tracking(self):
        self.assertEqual(self.app._page, "summary")
        self.assertEqual(self.controller.commands, [])
        self.assertIn("Paused", self.root.title())
        self.assertEqual(self.root.minsize(), (400, 590))

    def test_consent_navigation_does_not_authorize_or_start_tracking(self):
        self.controller.view["auth"].update(state="signed_in", signed_in=True, user_id="synthetic-employee")
        self.app.start_tracking()
        self.assertEqual(self.app._page, "consent")
        self.app._accept_consent()
        self.assertEqual(self.app._page, "summary")
        self.assertEqual(self.controller.commands, [])
        with patch("agent.ui.desktop.messagebox.askyesno", return_value=True):
            self.app.start_tracking()
        self.assertEqual(self.controller.commands, ["start"])

    def test_signed_out_start_opens_login_without_consent_or_tracking(self):
        self.app.start_tracking()
        self.assertEqual(self.app._page, "signin")
        self.assertFalse(self.app._consent_accepted)
        self.assertEqual(self.controller.commands, [])

    def test_employee_switch_requires_new_consent(self):
        self.controller.view["auth"].update(state="signed_in", signed_in=True, user_id="employee-one")
        self.app._accept_consent()
        self.controller.view["auth"]["user_id"] = "employee-two"
        self.app.start_tracking()
        self.assertEqual(self.app._page, "consent")
        self.assertEqual(self.controller.commands, [])

    def test_login_is_enabled_submits_to_controller_and_clears_password(self):
        self.app._show_page("signin")
        self.assertEqual(self.app.signin_button.cget("state"), "normal")
        self.assertEqual(self.app.email_entry.cget("state"), "normal")
        self.app._email.set(" employee@example.test ")
        self.app._password.set("Synthetic-password-123!")
        self.app._submit_login()
        self.controller.request_auth.assert_called_once_with("login", "employee@example.test", "Synthetic-password-123!")
        self.assertEqual(self.app._password.get(), "")
        self.assertEqual(self.app.signin_button.cget("state"), "disabled")
        self.app.show_summary()
        self.assertEqual(self.app._password.get(), "")
        self.assertEqual(self.controller.commands, [])

    def test_verified_login_updates_identity_without_starting_tracking(self):
        self.app._show_page("signin")
        self.controller.view["auth"].update(state="signed_in", signed_in=True, email="employee@example.test", revision=1)
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(self.app._page, "summary")
        self.assertEqual(self.app._account_heading.get(), "Signed in successfully")
        self.assertEqual(self.app._account_note.get(), "employee@example.test")
        self.assertEqual(self.app._connection_card.cget("fg_color"), "#F0FDF4")
        self.assertEqual(self.controller.commands, [])

    def test_failed_login_reenables_fields_and_preserves_safe_feedback(self):
        self.app._render_auth(dict(state="signing_in", revision=1, message="Signing in…"))
        self.app._render_auth(dict(state="signed_out", revision=1, message="Invalid email or password."))
        self.assertEqual(self.app.signin_button.cget("state"), "normal")
        self.assertEqual(self.app.email_entry.cget("state"), "normal")
        self.assertIn("Invalid", self.app._auth_message.get())

    def test_temporary_password_flow_never_starts_or_retains_passwords(self):
        auth = self.controller.view["auth"]
        auth.update(state="password_required", revision=1, message="Change temporary password.")
        self.app._render_auth(auth)
        self.assertEqual(self.app._page, "password")
        self.app.start_tracking()
        self.assertEqual(self.controller.commands, [])
        self.app._current_password.set("Temporary-password-123!")
        self.app._new_password.set("New-private-password-123!")
        self.app._confirm_password.set("mismatch")
        self.app._submit_password_change()
        self.controller.request_auth.assert_not_called()
        self.app._confirm_password.set("New-private-password-123!")
        self.app._submit_password_change()
        self.controller.request_auth.assert_called_once_with("change_password", "Temporary-password-123!", "New-private-password-123!")
        self.assertEqual(self.app._current_password.get() + self.app._new_password.get() + self.app._confirm_password.get(), "")

    def test_summary_uses_actual_values_and_does_not_claim_queued_uploads(self):
        self.controller.view["active_seconds"] = 3660
        self.controller.view["idle_seconds"] = 120
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(self.app._duration_vars["total"].get(), "1h 03m")
        self.assertEqual(self.app._duration_vars["active"].get(), "1h 01m")
        self.assertEqual(self.app.values["mouse_movements"].get(), "12")
        self.assertEqual(self.app.values["mouse_clicks"].get(), "3")
        self.assertEqual(self.app.values["active_app"].get(), "synthetic.exe")
        self.assertEqual(self.app._account_heading.get(), "Not signed in")
        self.assertEqual(short_duration(0), "0h 00m")

    def test_signed_in_account_stays_successful_when_synchronization_is_offline(self):
        self.controller.view["auth"].update(state="signed_in", signed_in=True, email="employee@example.test")
        self.controller.view["sync"] = "Offline: synchronization pending"
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(self.app._account_heading.get(), "Signed in successfully")
        self.assertEqual(self.app._connection_card.cget("fg_color"), "#F0FDF4")

    def test_summary_omits_sync_panel_but_details_keep_the_actual_diagnostics(self):
        def label_texts(widget):
            values = []
            try:
                values.append(widget.cget("text"))
            except (ValueError, tk.TclError):
                pass
            for child in widget.winfo_children():
                values.extend(label_texts(child))
            return values
        labels = label_texts(self.app._pages["summary"])
        for text in ("SYNCHRONIZATION", "Last successful sync", "Next work window", "Local cached buffer", "Not configured", "Not connected", "Never"):
            self.assertNotIn(text, labels)
        with patch("agent.ui.compact.messagebox.showinfo") as details:
            self.app._show_details()
        self.assertIn("Last successful synchronization: Never", details.call_args.args[1])
        self.assertEqual(self.controller.view["last_sync"], "Never")

    def test_authentication_in_progress_and_password_changes_are_not_shown_as_login_success(self):
        for state, heading in (("checking_session", "Verifying employee account…"), ("password_required", "Password change required"), ("signed_out", "Not signed in")):
            self.app._render_account(dict(state=state, signed_in=False, message="Synthetic status"))
            self.assertEqual(self.app._account_heading.get(), heading)
            self.assertNotEqual(self.app._connection_card.cget("fg_color"), "#F0FDF4")

    def test_sign_out_requests_safe_logout_and_shows_signin(self):
        self.app._sign_out()
        self.assertEqual(self.controller.commands, ["logout"])
        self.assertEqual(self.app._page, "signin")

    def test_next_window_handles_spring_gap_and_overnight_start_day(self):
        spring = WorkingHoursPolicy(zone="America/New_York", start=time(2, 30), end=time(4), days={6})
        result = spring.next_start(datetime(2026, 3, 8, 5, tzinfo=timezone.utc))
        self.assertEqual(result.astimezone(timezone.utc), datetime(2026, 3, 8, 7, tzinfo=timezone.utc))
        overnight = WorkingHoursPolicy(zone="UTC", start=time(22), end=time(6), days={4})
        self.assertEqual(overnight.next_start(datetime(2026, 11, 20, 20, tzinfo=timezone.utc)), datetime(2026, 11, 20, 22, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
