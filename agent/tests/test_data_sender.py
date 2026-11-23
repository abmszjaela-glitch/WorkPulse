"""Synthetic transport/vault tests: no real employee, input or network access."""
from datetime import datetime, timezone, timedelta
from threading import Event
from unittest import TestCase
from unittest.mock import Mock, patch
from uuid import uuid4

from agent.auth.client import AuthenticationError
from agent.auth.device_store import DeviceCredentials, DeviceCredentialStore
from agent.auth.token_store import TokenStorageError
from agent.core.data_sender import DataSender, DeviceToken
from agent.core.remote_policy import RemoteWorkingHours


class DataSenderTests(TestCase):
    def setUp(self):
        self.owner, self.device_id = str(uuid4()), str(uuid4())
        self.auth = Mock(tracking_identity=Mock(return_value=self.owner))
        self.api = Mock(server_url="https://backend.example.test/api/v1")
        self.vault = Mock()
        self.queue = Mock()
        self.queue.get_statistics.return_value = {"pending": 0}
        self.sender = DataSender(self.auth, api=self.api, store_factory=Mock(return_value=self.vault), queue_factory=Mock(return_value=self.queue))
        self.sender._owner, self.sender._queue = self.owner, self.queue
        self.sender._token = DeviceToken("synthetic-device-token", 9999999999, self.device_id)
        self.hours = {"timezone": "UTC", "configured": True, "schedule": [
            {"enabled": True, "start": "00:00", "end": "23:59"} for _ in range(7)]}
        self.remote = {"workingHours": self.hours, "policyVersion": 1, "consentAccepted": True,
                       "idleThreshold": 300, "trackingInterval": 60, "syncInterval": 60}
        self.sender._policy = RemoteWorkingHours(self.hours)
        self.sender._update(ready=True, consent_accepted=True)

    def test_exact_partial_acknowledgement_deletes_only_successes_and_retains_rejections(self):
        first, second = str(uuid4()), str(uuid4())
        self.queue.retrieve_pending.return_value = [{"record_id": first, "employee_id": self.owner}, {"record_id": second, "employee_id": self.owner}]
        self.api._request.return_value = {"acknowledged_record_ids": [first], "results": [{"record_id": first, "status": "duplicate"}, {"record_id": second, "status": "rejected"}]}
        self.sender.send_pending()
        self.queue.mark_synchronized.assert_called_once_with({first})
        self.queue.delete_synchronized.assert_called_once_with({first})
        self.assertNotEqual(self.sender.snapshot()["last_sync"], "Never")
        self.assertIn("remain queued", self.sender.snapshot()["message"])
        self.assertEqual(self.api._request.call_args.args, ("POST", "/activity/batch"))
        self.assertIsInstance(self.api._request.call_args.kwargs["body"], list)

    def test_network_failure_and_malformed_acknowledgement_keep_all_records(self):
        identifier = str(uuid4())
        self.queue.retrieve_pending.return_value = [{"record_id": identifier, "employee_id": self.owner}]
        for response in (AuthenticationError("network"), {"acknowledged_record_ids": [str(uuid4())], "results": []},
                         {"acknowledged_record_ids": [identifier], "results": [{"record_id": identifier, "status": "rejected"}]}):
            self.api._request.side_effect = response if isinstance(response, Exception) else None
            self.api._request.return_value = response
            with self.assertRaises(AuthenticationError):
                self.sender.send_pending()
        self.queue.mark_synchronized.assert_not_called()
        self.queue.delete_synchronized.assert_not_called()
        self.assertEqual(self.sender.snapshot()["last_sync"], "Never")

    def test_wrong_employee_queue_or_late_previous_employee_callback_never_uploads(self):
        self.queue.retrieve_pending.return_value = [{"record_id": str(uuid4()), "employee_id": str(uuid4())}]
        with self.assertRaises(RuntimeError):
            self.sender.send_pending()
        with self.assertRaises(RuntimeError):
            self.sender.enqueue(None, None, {}, owner=str(uuid4()))
        self.api._request.assert_not_called()
        self.queue.enqueue.assert_not_called()

    def test_policy_key_ignores_heartbeat_status_but_changes_for_collection_policy(self):
        remote = dict(self.remote, last_seen="old", status="PAUSED")
        self.api._request.side_effect = lambda method, path, **_: remote if path == "/devices/agent-config" else {"version": 1, "content": "Synthetic policy"}
        self.sender._load_policy()
        first = self.sender.snapshot()["policy_key"]
        remote.update(last_seen="new", status="ACTIVE")
        self.sender._load_policy()
        self.assertEqual(first, self.sender.snapshot()["policy_key"])
        remote["idleThreshold"] = 600
        self.sender._load_policy()
        self.assertNotEqual(first, self.sender.snapshot()["policy_key"])

    def test_server_consent_and_employee_session_are_both_required(self):
        self.assertTrue(self.sender.can_record(self.owner))
        self.sender._update(consent_accepted=False)
        self.assertFalse(self.sender.can_record(self.owner))
        self.sender._update(consent_accepted=True)
        self.auth.tracking_identity.return_value = None
        self.assertFalse(self.sender.can_record(self.owner))
        with self.assertRaises(AuthenticationError):
            self.sender._request("POST", "/activity/batch", [])
        self.api._request.assert_not_called()

    def test_device_token_is_verified_with_server_against_logged_in_owner(self):
        self.api._request.side_effect = [{"accessToken": "synthetic", "expiresIn": 900, "tokenType": "Bearer"},
                                        {"role": "Agent", "deviceId": self.device_id, "user": {"id": str(uuid4())}}]
        with self.assertRaises(AuthenticationError):
            self.sender._issue(DeviceCredentials(self.owner, self.device_id, "x" * 43))
        self.api.logout.assert_called_once_with("synthetic")

    def test_activation_rotates_and_saves_secret_and_uses_device_scoped_queue(self):
        self.sender._queue = None
        def request(method, path, **kwargs):
            return {"/devices/token": {"accessToken": "synthetic", "expiresIn": 900, "tokenType": "Bearer"},
                    "/auth/me": {"role": "Agent", "deviceId": self.device_id, "user": {"id": self.owner}},
                    "/devices/register": {"device": {"id": self.device_id, "user_id": self.owner}, "deviceCredential": "y" * 43,
                                          "accessToken": "rotated", "expiresIn": 900, "tokenType": "Bearer"},
                    "/devices/agent-config": self.remote, "/consent/policy": {"version": 1, "content": "Synthetic policy"}}[path]
        self.api._request.side_effect = request
        self.sender._connect(self.owner, (self.device_id, "x" * 43))
        self.assertEqual(self.vault.save.call_args.args[0].credential, "y" * 43)
        path = self.sender._queue_factory.call_args.kwargs["database_path"]
        self.assertEqual(path.parent.name, self.device_id)
        self.assertTrue(self.sender.can_record(self.owner))

    def test_start_stop_never_collects_or_connects_while_signed_out(self):
        self.auth.tracking_identity.return_value = None
        self.sender._queue = self.sender._token = None
        self.sender.start()
        self.sender.stop()
        self.assertFalse(self.sender._thread.is_alive())
        self.api._request.assert_not_called()

    def test_empty_queue_does_not_claim_success_or_make_http_call(self):
        self.queue.retrieve_pending.return_value = []
        self.sender.send_pending()
        self.assertEqual(self.sender.snapshot()["last_sync"], "Never")
        self.api._request.assert_not_called()

    def test_batch_byte_limit_splits_upload_without_discarding_other_pending_records(self):
        first, second = str(uuid4()), str(uuid4())
        records = [{"record_id": value, "employee_id": self.owner, "summary": {"aggregate": "x" * 100}} for value in (first, second)]
        self.queue.retrieve_pending.return_value = records
        self.api._request.return_value = {"acknowledged_record_ids": [first], "results": [{"record_id": first, "status": "accepted"}]}
        with patch("agent.core.data_sender.config.SYNC_MAX_BATCH_BYTES", 300):
            self.sender.send_pending()
        self.assertEqual(self.api._request.call_args.kwargs["body"], records[:1])
        self.queue.delete_synchronized.assert_called_once_with({first})


class DeviceStoreTests(TestCase):
    def test_employee_and_server_scoping_and_secret_representation(self):
        owner, device = str(uuid4()), str(uuid4())
        one = DeviceCredentialStore("https://one.example.test/api/v1", owner)
        self.assertNotEqual(one._target, DeviceCredentialStore("https://two.example.test/api/v1", owner)._target)
        self.assertNotEqual(one._target, DeviceCredentialStore("https://one.example.test/api/v1", str(uuid4()))._target)
        credentials = DeviceCredentials(owner, device, "synthetic-private-value".ljust(43, "x"))
        self.assertNotIn(credentials.credential, repr(credentials))
        with patch("agent.auth.device_store.win32cred.CredWrite") as write:
            one.save(credentials)
            blob = write.call_args.args[0]["CredentialBlob"]
        with patch("agent.auth.device_store.win32cred.CredRead", return_value={"CredentialBlob": blob.encode("utf-16-le")}):
            self.assertEqual(one.load(), credentials)
        with self.assertRaises(TokenStorageError):
            one.save(DeviceCredentials(str(uuid4()), device, credentials.credential))

    def test_invalid_secrets_are_not_saved(self):
        store = DeviceCredentialStore("https://backend.example.test/api/v1", "employee")
        with patch("agent.auth.device_store.win32cred.CredWrite") as write:
            for value in ("", "invalid secret", "x" * 100):
                with self.assertRaises(TokenStorageError):
                    store.save(DeviceCredentials("employee", str(uuid4()), value))
            write.assert_not_called()


class RemoteHoursTests(TestCase):
    def test_unconfigured_policy_fails_closed_and_overnight_respects_start_day(self):
        with self.assertRaises(ValueError):
            RemoteWorkingHours({"configured": False, "schedule": None})
        schedule = [{"enabled": i == 4, "start": "22:00", "end": "06:00"} for i in range(7)]
        policy = RemoteWorkingHours({"timezone": "UTC", "schedule": schedule})
        self.assertTrue(policy.allows(datetime(2026, 11, 21, 3, tzinfo=timezone.utc)))
        self.assertFalse(policy.allows(datetime(2026, 11, 21, 22, tzinfo=timezone.utc)))
