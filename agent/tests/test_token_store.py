"""Token-storage unit tests; fabricated tokens and mocked Credential Manager."""

import io
import json
import unittest
import time
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch
from uuid import uuid4

import pywintypes
import winerror

from agent.auth.token_store import StoredAccessToken, TokenStorageError, WindowsTokenStore


class WindowsTokenStoreTests(unittest.TestCase):
    def setUp(self):
        self.records = {}
        self.now = 1000.0
        clock = patch("agent.auth.token_store.time.time", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

        def write(record, _flags):
            self.records[record["TargetName"]] = dict(record)

        def read(target, _kind, _flags):
            if target not in self.records:
                raise pywintypes.error(winerror.ERROR_NOT_FOUND, "read", "private")
            return self.records[target]

        def delete(target, _kind, _flags):
            if target not in self.records:
                raise pywintypes.error(winerror.ERROR_NOT_FOUND, "delete", "private")
            del self.records[target]

        for method, callback in (("CredWrite", write), ("CredRead", read), ("CredDelete", delete)):
            api = patch("agent.auth.token_store.win32cred." + method, side_effect=callback)
            api.start()
            self.addCleanup(api.stop)
        self.store = WindowsTokenStore("https://test.invalid/api", namespace="WorkPulseAgent.Test")

    def test_save_load_and_idempotent_clear(self):
        self.assertIsNone(self.store.load())
        self.store.save("synthetic.token.for-testing", 2000)
        self.assertEqual(self.store.load().token, "synthetic.token.for-testing")
        self.store.clear()
        self.store.clear()
        self.assertIsNone(self.store.load())

    def test_expiration_clears_storage_at_exact_boundary(self):
        self.store.save("synthetic-token", 2000)
        self.now = 2000
        self.assertIsNone(self.store.load())
        self.assertEqual(self.records, {})

    def test_expired_invalid_and_oversize_values_are_not_stored(self):
        for token, expiry in (("", 2000), ("line\nbreak", 2000), ("synthetic", 1000), ("synthetic", float("nan"))):
            with self.subTest(expiry=expiry), self.assertRaises(ValueError):
                self.store.save(token, expiry)
        with self.assertRaises(TokenStorageError):
            self.store.save("a" * 3000, 2000)
        self.assertEqual(self.records, {})

    def test_credential_targets_are_scoped_to_backend_and_no_email_is_stored(self):
        other = WindowsTokenStore("https://other.invalid/api", namespace="WorkPulseAgent.Test")
        self.assertNotEqual(self.store._target, other._target)
        self.store.save("synthetic-token", 2000)
        record = self.records[self.store._target]
        self.assertEqual(record["UserName"], "WorkPulse Agent")
        self.assertEqual(set(json.loads(record["CredentialBlob"])), {"version", "access_token", "expires_at"})

    def test_corrupt_cache_is_removed_without_logging_its_contents(self):
        self.store.save("synthetic-token", 2000)
        self.records[self.store._target]["CredentialBlob"] = b"invalid-private-data"
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr), patch("logging.Logger._log") as log:
            with self.assertRaises(TokenStorageError) as error:
                self.store.load()
            log.assert_not_called()
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
        self.assertNotIn("invalid-private-data", str(error.exception))
        self.assertEqual(self.records, {})

    def test_native_errors_are_sanitized_without_plaintext_fallback(self):
        with patch("agent.auth.token_store.win32cred.CredWrite",
                   side_effect=pywintypes.error(5, "write", "private-token")):
            with self.assertRaises(TokenStorageError) as error:
                self.store.save("synthetic-token", 2000)
        self.assertNotIn("private-token", str(error.exception))
        self.assertEqual(self.records, {})

    def test_token_is_excluded_from_default_object_representation(self):
        stored = StoredAccessToken("synthetic-secret-token", 2000)
        self.assertNotIn("synthetic-secret-token", repr(stored))


class WindowsCredentialManagerIntegrationTests(unittest.TestCase):
    def test_synthetic_credential_round_trip_and_deletion(self):
        # This unique test namespace never reads/enumerates existing credentials.
        store = WindowsTokenStore(
            "https://synthetic-test.invalid/api",
            namespace="WorkPulseAgent.Test." + uuid4().hex,
        )
        try:
            store.save("synthetic-token-not-an-authentication-token", time.time() + 60)
            self.assertEqual(store.load().token, "synthetic-token-not-an-authentication-token")
        finally:
            store.clear()
        self.assertIsNone(store.load())


if __name__ == "__main__":
    unittest.main()
