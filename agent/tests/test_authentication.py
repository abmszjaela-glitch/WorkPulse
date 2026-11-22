"""Synthetic backend contract and race tests; no real employee credentials."""
from contextlib import redirect_stderr, redirect_stdout
import io
from threading import Event, Thread
import unittest
from unittest.mock import Mock

import requests

from agent.auth.client import AuthenticationError, VerifiedSession, WorkPulseAuthClient
from agent.auth.session import AgentAuthentication
from agent.auth.token_store import StoredAccessToken, TokenStorageError


TOKEN = "synthetic.access.token"
USER = {"id": "employee-fixture", "email": "employee@example.test", "role": "E", "mustChangePassword": False}


def reply(status=200, data=None):
    return Mock(status_code=status, json=Mock(return_value=data), close=Mock())


class AuthClientTests(unittest.TestCase):
    def setUp(self):
        self.http = Mock()
        self.client = WorkPulseAuthClient("http://localhost:5000/api/v1", transport=self.http, clock=lambda: 1000)

    def login_replies(self, user=None):
        self.http.request.side_effect = [
            reply(data={"accessToken": TOKEN, "refreshToken": "discarded-refresh", "tokenType": "Bearer", "expiresIn": 900,
                        "user": {"role": "A"}}),  # Login user is deliberately untrusted.
            reply(data={"user": user or USER}),
        ]

    def test_login_verifies_actual_me_contract_and_never_sends_frontend_role(self):
        self.login_replies()
        session = self.client.login(" employee@example.test ", "Exact password 123!")
        self.assertEqual(session.role, "E")
        self.assertEqual(session.expires_at, 1900)
        calls = self.http.request.call_args_list
        self.assertEqual(calls[0].args, ("POST", "http://localhost:5000/api/v1/auth/login"))
        self.assertEqual(calls[0].kwargs["json"], {"email": "employee@example.test", "password": "Exact password 123!"})
        self.assertFalse(calls[0].kwargs["allow_redirects"])
        self.assertEqual(calls[1].args[0], "GET")
        self.assertEqual(calls[1].kwargs["headers"]["Authorization"], "Bearer " + TOKEN)
        self.assertNotIn(TOKEN, repr(session))

    def test_rejects_unverified_device_or_malformed_user_responses(self):
        for body in ({"user": USER, "role": "Agent", "deviceId": "fixture-device"}, {"user": {"role": "E"}}, {}):
            self.http.request.side_effect = None
            self.http.request.return_value = reply(data=body)
            with self.assertRaises(AuthenticationError):
                self.client.verify(TOKEN, 1900)

    def test_http_errors_and_network_exceptions_do_not_expose_server_contents(self):
        for status, code in ((401, "invalid_credentials"), (429, "rate_limit"), (503, "unavailable"), (302, "invalid_response"), (400, "invalid_fields")):
            self.http.request.return_value = reply(status, {"private": "password-token-value"})
            with self.assertRaises(AuthenticationError) as error:
                self.client.login("employee@example.test", "synthetic")
            self.assertEqual(error.exception.code, code)
            self.assertNotIn("password-token-value", str(error.exception))
        self.http.request.side_effect = requests.ConnectionError("private-token")
        with self.assertRaises(AuthenticationError) as error:
            self.client.login("employee@example.test", "synthetic")
        self.assertEqual(error.exception.code, "network")
        self.assertNotIn("private-token", str(error.exception))

    def test_remote_http_and_legacy_api_base_reject_before_credentials_leave(self):
        for base in ("http://remote.example.test/api/v1", "http://localhost:5000/api", "https://user:secret@example.test/api/v1"):
            with self.assertRaises(AuthenticationError) as error:
                WorkPulseAuthClient(base, transport=self.http).login("employee@example.test", "synthetic")
            self.assertEqual(error.exception.code, "configuration")
        self.http.request.assert_not_called()

    def test_password_change_and_logout_reuse_real_routes(self):
        self.http.request.return_value = reply(204)
        self.client.change_password(TOKEN, "temporary", "new-password")
        call = self.http.request.call_args
        self.assertEqual(call.args, ("PUT", "http://localhost:5000/api/v1/auth/change-password"))
        self.assertEqual(call.kwargs["json"], {"currentPassword": "temporary", "newPassword": "new-password"})
        self.assertTrue(self.client.logout(TOKEN))
        self.assertTrue(self.http.request.call_args.args[1].endswith("/auth/logout"))


class AuthSessionTests(unittest.TestCase):
    def setUp(self):
        self.store, self.client = Mock(), Mock()
        self.now = 1000
        self.verified = VerifiedSession(TOKEN, 1900, USER["id"], USER["email"], "E", False)
        self.client.login.return_value = self.verified
        self.client.verify.return_value = self.verified
        self.client.logout.return_value = True
        self.auth = AgentAuthentication(self.store, client=self.client, clock=lambda: self.now)

    def sign_in(self):
        job = self.auth.begin("login", USER["email"], "synthetic-password")
        self.assertNotIn("synthetic-password", repr(job))
        self.auth.perform(job)

    def test_only_verified_access_token_is_saved_and_snapshot_contains_no_credentials(self):
        self.sign_in()
        self.store.save.assert_called_once_with(TOKEN, 1900)
        self.assertEqual(self.auth.snapshot()["state"], "signed_in")
        self.assertNotIn(TOKEN, repr(self.auth.snapshot()))

    def test_secure_storage_failure_fails_closed_and_revokes_new_session(self):
        self.store.save.side_effect = TokenStorageError("synthetic-private-error")
        self.sign_in()
        self.assertFalse(self.auth.snapshot()["signed_in"])
        self.assertIn("Credential Manager", self.auth.snapshot()["message"])
        self.client.logout.assert_called_once_with(TOKEN)

    def test_temporary_password_is_not_cached_and_change_requires_new_signin(self):
        self.client.login.return_value = VerifiedSession(TOKEN, 1900, USER["id"], USER["email"], "E", True)
        self.sign_in()
        self.assertEqual(self.auth.snapshot()["state"], "password_required")
        self.store.save.assert_not_called()
        self.auth.perform(self.auth.begin("change_password", "temporary", "new-password"))
        self.client.change_password.assert_called_once_with(TOKEN, "temporary", "new-password")
        self.assertEqual(self.auth.snapshot()["state"], "signed_out")
        self.assertIn("Password updated", self.auth.snapshot()["message"])
        self.assertEqual(self.store.clear.call_count, 2)

    def test_expiry_invalidates_local_auth_without_waiting_for_network(self):
        self.sign_in()
        self.now = 1900
        self.assertTrue(self.auth.expire())
        self.assertFalse(self.auth.snapshot()["signed_in"])
        self.client.logout.assert_not_called()
        self.assertFalse(self.auth.expire())

    def test_restore_reverifies_cached_token_and_does_not_trust_cache_as_identity(self):
        self.store.load.return_value = StoredAccessToken(TOKEN, 1900)
        self.auth.perform(self.auth.begin("restore"))
        self.client.verify.assert_called_once_with(TOKEN, 1900)
        self.assertTrue(self.auth.snapshot()["signed_in"])

    def test_logout_removes_cache_and_reports_unconfirmed_remote_revocation(self):
        self.sign_in()
        self.client.logout.return_value = False
        self.auth.logout()
        self.assertFalse(self.auth.snapshot()["signed_in"])
        self.assertEqual(self.store.clear.call_count, 2)
        self.assertIn("could not be confirmed", self.auth.snapshot()["message"])

    def test_late_login_after_cancel_cannot_restore_session_or_write_token(self):
        entered, release = Event(), Event()
        def delayed(*_):
            entered.set()
            release.wait(3)
            return self.verified
        self.client.login.side_effect = delayed
        job = self.auth.begin("login", USER["email"], "synthetic-password")
        worker = Thread(target=self.auth.perform, args=(job,))
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            self.auth.cancel()
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.store.save.assert_not_called()
        self.assertFalse(self.auth.snapshot()["signed_in"])
        self.client.logout.assert_called_once_with(TOKEN)

    def test_duplicate_submissions_and_errors_are_safe(self):
        job = self.auth.begin("login", USER["email"], "synthetic-password")
        self.assertIsNone(self.auth.begin("login", USER["email"], "duplicate"))
        self.client.login.side_effect = RuntimeError("private-password-and-token")
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            self.auth.perform(job)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn("private-password-and-token", self.auth.snapshot()["message"])


if __name__ == "__main__":
    unittest.main()
