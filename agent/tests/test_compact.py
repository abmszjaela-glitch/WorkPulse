"""Reference-screen behavior with fake controls, never real activity input."""
from datetime import datetime, time, timezone
import gc
import tkinter as tk
import unittest
from unittest.mock import patch

from agent.core.working_hours import WorkingHoursPolicy
from agent.ui.compact import CompactDesktop, short_duration
from test_desktop import FakeController


class CompactTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.controller = FakeController()
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
        self.app.start_tracking()
        self.assertEqual(self.app._page, "consent")
        self.app._accept_consent()
        self.assertEqual(self.app._page, "summary")
        self.assertEqual(self.controller.commands, [])
        with patch("agent.ui.desktop.messagebox.askyesno", return_value=True):
            self.app.start_tracking()
        self.assertEqual(self.controller.commands, ["start"])

    def test_unavailable_login_does_not_collect_passwords_or_fake_success(self):
        self.app._show_page("signin")
        self.assertEqual(self.app.signin_button.cget("state"), "disabled")
        self.assertEqual(self.app.email_entry.cget("state"), "disabled")
        self.app._password.set("synthetic-password")
        self.app.show_summary()
        self.assertEqual(self.app._password.get(), "")
        self.assertEqual(self.controller.commands, [])

    def test_summary_uses_actual_values_and_does_not_claim_queued_uploads(self):
        self.controller.view["active_seconds"] = 3660
        self.controller.view["idle_seconds"] = 120
        with patch("agent.ui.desktop.logging_available", return_value=True):
            self.app._poll()
        self.assertEqual(self.app._duration_vars["total"].get(), "1h 03m")
        self.assertEqual(self.app._duration_vars["active"].get(), "1h 01m")
        self.assertEqual(self.app._buffer.get(), "Not connected")
        self.assertEqual(self.app.values["mouse_movements"].get(), "12")
        self.assertEqual(self.app.values["mouse_clicks"].get(), "3")
        self.assertEqual(self.app.values["active_app"].get(), "synthetic.exe")
        self.assertNotIn("Offline", self.app._sync_heading.get())
        self.assertEqual(short_duration(0), "0h 00m")

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
