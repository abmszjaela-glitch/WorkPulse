"""Hidden Tk UI tests with fabricated form values; no HTTP or authentication."""

import io
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock

import tkinter as tk

from agent.ui.login import LoginForm, validate_login_fields


class LoginFormTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.addCleanup(self.root.destroy)

    def test_missing_backend_disables_credentials_and_submission(self):
        form = LoginForm(self.root)
        self.assertTrue(form.email_entry.instate(["disabled"]))
        self.assertTrue(form.password_entry.instate(["disabled"]))
        self.assertTrue(form.submit_button.instate(["disabled"]))
        self.assertIn("unavailable", form._status.get())

    def test_password_is_masked_cleared_and_duplicate_submit_is_blocked(self):
        handler = Mock()
        form = LoginForm(self.root, on_login=handler)
        self.assertEqual(form.password_entry.cget("show"), "*")
        form._email.set(" employee@example.invalid ")
        form._password.set("fabricated-test-password")
        form._submit()
        handler.assert_called_once_with("employee@example.invalid", "fabricated-test-password")
        self.assertEqual(form._password.get(), "")
        self.assertTrue(form.submit_button.instate(["disabled"]))
        form._submit()
        self.assertEqual(handler.call_count, 1)

    def test_empty_fields_do_not_reach_backend_handler(self):
        handler = Mock()
        form = LoginForm(self.root, on_login=handler)
        form._submit()
        handler.assert_not_called()
        self.assertEqual(validate_login_fields("employee@example.invalid", ""), "Enter your password.")

    def test_backend_exception_is_not_printed_or_shown(self):
        form = LoginForm(self.root, on_login=Mock(side_effect=RuntimeError("private-token")))
        form._email.set("employee@example.invalid")
        form._password.set("fabricated-test-password")
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            form._submit()
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
        self.assertNotIn("private-token", form._status.get())
        self.assertTrue(form.submit_button.instate(["!disabled"]))

    def test_network_invalid_credentials_and_expiry_feedback(self):
        form = LoginForm(self.root, on_login=Mock())
        for reason, expected in (("network", "connection"), ("invalid_credentials", "Invalid email"), ("expired", "expired")):
            form.show_error(reason)
            self.assertIn(expected, form._status.get())


if __name__ == "__main__":
    unittest.main()
