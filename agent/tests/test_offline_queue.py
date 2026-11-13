"""Synthetic queue data with real temporary SQLite, Windows DPAPI and ACLs.

All databases are confined to temporary subdirectories of agent/tests. No real
employee data, activity input, credentials or network services are used.
"""

import copy
import json
import os
import runpy
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import pywintypes
import win32security

from agent.core.offline_queue import OfflineQueue
from agent.core.queue_errors import (
    QueueConflictError, QueueError, QueueFullError, QueueRetentionError,
    QueueSecurityError, QueueValidationError,
)


class OfflineQueueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix=".queue-test-", dir=Path(__file__).resolve().parent
        )
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "private-queue" / "activity.sqlite3"
        self.now = datetime(2026, 11, 13, 12, tzinfo=timezone.utc).timestamp()
        clock = patch("agent.core.offline_queue.time.time", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.queue = OfflineQueue(self.path)
        self.addCleanup(self.queue.close)
        self.summary = {
            "interval_seconds": 60.0,
            "counts": {"mouse_movements": 12, "mouse_clicks": 3, "key_presses": 8},
            "active_seconds": 45.0, "idle_seconds": 15.0,
            "application_usage_seconds": {"editor.exe": 45.0},
            "status": "ACTIVE", "activity_score": 42.0,
        }

    def enqueue(self, index=0, **kwargs):
        end = datetime.fromtimestamp(self.now, timezone.utc) - timedelta(minutes=index)
        return self.queue.enqueue(
            "EMP-TEST-0001", end - timedelta(seconds=60), end,
            copy.deepcopy(self.summary), **kwargs,
        )

    def reopen(self, **options):
        self.queue.close()
        self.queue = OfflineQueue(self.path, **options)
        self.addCleanup(self.queue.close)

    def test_insert_retrieve_uuid_and_encrypted_at_rest(self):
        identifier = self.enqueue()
        self.assertEqual(str(UUID(identifier)), identifier)
        record = self.queue.retrieve_pending()[0]
        self.assertEqual(record["record_id"], identifier)
        self.assertEqual(record["employee_id"], "EMP-TEST-0001")
        self.assertEqual(record["sync_status"], "pending")
        self.assertEqual(record["summary"]["counts"], self.summary["counts"])
        self.assertEqual(record["summary"]["application_usage_seconds"], {"editor.exe": 45.0})
        self.assertEqual(json.loads(json.dumps(record)), record)
        database = self.path.read_bytes()
        self.assertNotIn(b"EMP-TEST-0001", database)
        self.assertNotIn(b"editor.exe", database)
        self.assertNotIn(b"mouse_movements", database)

    def test_pending_records_survive_reopen_and_offline_retries(self):
        identifier = self.enqueue()
        self.reopen()
        for _ in range(3):
            self.assertEqual(self.queue.retrieve_pending()[0]["record_id"], identifier)
        self.assertEqual(self.queue.get_statistics()["pending"], 1)

    def test_exact_retry_deduplicates_and_conflicts_do_not_overwrite(self):
        identifier = self.enqueue()
        self.assertEqual(self.enqueue(), identifier)
        self.assertEqual(self.enqueue(record_id=identifier), identifier)
        self.summary["counts"]["key_presses"] += 1
        with self.assertRaises(QueueConflictError):
            self.enqueue()
        self.assertEqual(self.queue.retrieve_pending()[0]["summary"]["counts"]["key_presses"], 8)

    def test_record_id_cannot_be_reused_for_another_interval(self):
        identifier = self.enqueue()
        with self.assertRaises(QueueConflictError):
            self.enqueue(index=1, record_id=identifier)
        self.assertEqual(self.queue.get_statistics()["pending"], 1)

    def test_acknowledge_then_delete_preserves_receipt_and_prevents_reenqueue(self):
        identifier = self.enqueue()
        self.assertEqual(self.queue.delete_synchronized([identifier]), 0)
        self.assertEqual(self.queue.mark_synchronized([identifier]), 1)
        self.assertEqual(self.queue.mark_synchronized([identifier]), 0)
        self.assertEqual(self.queue.retrieve_pending(), [])
        self.assertEqual(self.queue.get_statistics()["synced"], 1)
        self.assertEqual(self.queue.delete_synchronized([identifier]), 1)
        self.assertEqual(self.enqueue(), identifier)
        self.assertEqual(self.queue.get_statistics()["pending"], 0)
        self.assertEqual(self.queue.get_statistics()["synced"], 0)

    def test_only_acknowledged_payloads_can_be_deleted(self):
        first, second = self.enqueue(), self.enqueue(index=1)
        self.queue.mark_synchronized(first)
        self.assertEqual(self.queue.delete_synchronized(), 1)
        self.assertEqual([row["record_id"] for row in self.queue.retrieve_pending()], [second])

    def test_queue_count_limit_retains_pending_records(self):
        self.reopen(max_records=1)
        identifier = self.enqueue()
        with self.assertRaises(QueueFullError):
            self.enqueue(index=1)
        self.assertEqual(self.queue.retrieve_pending()[0]["record_id"], identifier)

    def test_queue_byte_and_per_record_limits(self):
        self.reopen(max_bytes=1)
        with self.assertRaises(QueueFullError):
            self.enqueue()
        self.reopen(max_record_bytes=20)
        with self.assertRaises(QueueFullError):
            self.enqueue()
        self.assertEqual(self.queue.get_statistics()["pending"], 0)

    def test_explicit_retention_expiration_removes_pending_records(self):
        self.reopen(retention_days=1)
        self.enqueue()
        self.now += 86401
        self.assertEqual(self.queue.prune_expired(), 1)
        self.assertEqual(self.queue.retrieve_pending(), [])

    def test_old_intervals_are_not_inserted(self):
        with self.assertRaises(QueueRetentionError):
            self.enqueue(index=8 * 24 * 60)
        self.assertEqual(self.queue.get_statistics()["pending"], 0)

    def test_credentials_content_and_individual_keys_are_rejected(self):
        for field in ("password", "jwt", "typed_text", "screenshots", "window_title", "url"):
            with self.subTest(field=field):
                self.summary[field] = "must-not-be-stored"
                with self.assertRaises(QueueValidationError):
                    self.enqueue()
                del self.summary[field]
        self.summary["counts"]["key_names"] = ["must-not-be-stored"]
        with self.assertRaises(QueueValidationError):
            self.enqueue()
        self.assertEqual(self.queue.get_statistics()["pending"], 0)

    def test_invalid_durations_urls_and_naive_timestamps_are_rejected(self):
        self.summary["active_seconds"] = float("nan")
        with self.assertRaises(QueueValidationError):
            self.enqueue()
        self.summary["active_seconds"] = 45.0
        self.summary["application_usage_seconds"] = {"https://example.com/private": 45}
        with self.assertRaises(QueueValidationError):
            self.enqueue()
        self.summary["application_usage_seconds"] = {"editor.exe": 45}
        with self.assertRaises(QueueValidationError):
            self.queue.enqueue("EMP-TEST-0001", datetime(2026, 11, 13), datetime(2026, 11, 14), self.summary)

    def test_parameterized_sql_preserves_literal_application_names(self):
        name = "tool'; DROP TABLE activity_records;--.exe"
        self.summary["application_usage_seconds"] = {name: 45.0}
        self.enqueue()
        self.assertEqual(self.queue.retrieve_pending()[0]["summary"]["application_usage_seconds"], {name: 45.0})
        self.assertEqual(self.queue.get_statistics()["pending"], 1)

    def test_concurrent_inserts_return_one_stable_id(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            identifiers = list(pool.map(lambda _: self.enqueue(), range(16)))
        self.assertEqual(len(set(identifiers)), 1)
        self.assertEqual(self.queue.get_statistics()["pending"], 1)

    def test_two_connections_deduplicate_under_transaction_lock(self):
        other = OfflineQueue(self.path)
        self.addCleanup(other.close)
        end = datetime.fromtimestamp(self.now, timezone.utc)

        def enqueue(index):
            queue = self.queue if index % 2 else other
            return queue.enqueue("EMP-TEST-0001", end - timedelta(seconds=60), end, self.summary)

        with ThreadPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(enqueue, range(8)))
        self.assertEqual(len(set(ids)), 1)

    def test_encryption_error_rolls_back_and_has_no_plaintext_fallback(self):
        with patch("agent.core.windows_queue_security.win32crypt.CryptProtectData",
                   side_effect=pywintypes.error(5, "protect", "private-error")):
            with self.assertRaises(QueueSecurityError) as error:
                self.enqueue()
        self.assertNotIn("private-error", str(error.exception))
        self.assertEqual(self.queue.get_statistics()["pending"], 0)

    def test_corrupt_payload_is_preserved_not_acknowledged_or_deleted(self):
        identifier = self.enqueue()
        self.queue._connection.execute(
            "UPDATE activity_records SET payload = ? WHERE record_id = ?",
            (b"invalid-ciphertext", identifier),
        )
        with self.assertRaises(QueueSecurityError):
            self.queue.retrieve_pending()
        self.assertEqual(self.queue.get_statistics()["pending"], 1)
        self.assertEqual(self.queue.delete_synchronized(), 0)

    def test_database_corruption_is_not_silently_replaced(self):
        self.queue.close()
        self.path.write_bytes(b"not-a-sqlite-database")
        with self.assertRaises(QueueError):
            OfflineQueue(self.path)
        self.assertEqual(self.path.read_bytes(), b"not-a-sqlite-database")

    def test_security_failure_does_not_open_sqlite(self):
        with patch("agent.core.offline_queue.WindowsQueueSecurity.prepare",
                   side_effect=QueueSecurityError("Protection unavailable")):
            with patch("agent.core.offline_queue.sqlite3.connect") as connect:
                with self.assertRaises(QueueSecurityError):
                    OfflineQueue(Path(self.temporary.name) / "another" / "activity.sqlite3")
                connect.assert_not_called()

    def test_private_acl_is_protected_and_existing_shared_directory_is_unchanged(self):
        descriptor = win32security.GetNamedSecurityInfo(
            str(self.path.parent), win32security.SE_FILE_OBJECT,
            win32security.DACL_SECURITY_INFORMATION,
        )
        control, _ = descriptor.GetSecurityDescriptorControl()
        self.assertTrue(control & win32security.SE_DACL_PROTECTED)
        self.assertEqual(descriptor.GetSecurityDescriptorDacl().GetAceCount(), 2)
        shared = Path(self.temporary.name) / "shared"
        shared.mkdir()
        before_descriptor = win32security.GetNamedSecurityInfo(
            str(shared), win32security.SE_FILE_OBJECT, win32security.DACL_SECURITY_INFORMATION
        )
        before = win32security.ConvertSecurityDescriptorToStringSecurityDescriptor(
            before_descriptor, win32security.SDDL_REVISION_1,
            win32security.DACL_SECURITY_INFORMATION,
        )
        with self.assertRaises(QueueSecurityError):
            OfflineQueue(shared / "activity.sqlite3")
        after_descriptor = win32security.GetNamedSecurityInfo(
            str(shared), win32security.SE_FILE_OBJECT, win32security.DACL_SECURITY_INFORMATION
        )
        after = win32security.ConvertSecurityDescriptorToStringSecurityDescriptor(
            after_descriptor, win32security.SDDL_REVISION_1,
            win32security.DACL_SECURITY_INFORMATION,
        )
        self.assertEqual(before, after)
        self.assertFalse((shared / "activity.sqlite3").exists())

    def test_receipts_are_bounded_but_default_ids_remain_stable(self):
        self.reopen(max_records=1)
        first = self.enqueue()
        self.queue.mark_synchronized(first)
        self.queue.delete_synchronized()
        second = self.enqueue(index=1)
        self.queue.mark_synchronized(second)
        self.queue.delete_synchronized()
        self.assertEqual(self.queue._connection.execute(
            "SELECT COUNT(*) FROM sync_receipts"
        ).fetchone()[0], 1)
        self.assertEqual(self.enqueue(), first)

    def test_locked_database_error_does_not_discard_pending_records(self):
        identifier = self.enqueue()
        with patch("agent.core.offline_queue.config.OFFLINE_QUEUE_DB_TIMEOUT", 0):
            self.reopen()
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            blocker.execute("BEGIN EXCLUSIVE")
            with self.assertRaises(QueueError):
                self.queue.retrieve_pending()
        finally:
            blocker.execute("ROLLBACK")
            blocker.close()
        self.assertEqual(self.queue.retrieve_pending()[0]["record_id"], identifier)

    def test_timezone_normalization_deduplicates_equivalent_intervals(self):
        identifier = self.enqueue()
        offset = timezone(timedelta(hours=5, minutes=30))
        end = datetime.fromtimestamp(self.now, offset)
        again = self.queue.enqueue("EMP-TEST-0001", end - timedelta(seconds=60), end, self.summary)
        self.assertEqual(again, identifier)

    def test_invalid_limits_ids_and_closed_queue(self):
        for options in ({"max_records": 0}, {"retention_days": -1}, {"max_bytes": 0}):
            with self.subTest(options=options), self.assertRaises(QueueValidationError):
                OfflineQueue(self.path, **options)
        with self.assertRaises(QueueValidationError):
            self.enqueue(record_id="invalid")
        with self.assertRaises(QueueValidationError):
            self.queue.retrieve_pending(limit=0)
        with self.assertRaises(QueueValidationError):
            self.queue.mark_synchronized(None)
        self.queue.close()
        self.queue.close()
        with self.assertRaises(QueueError):
            self.queue.retrieve_pending()

    def test_queue_limits_and_path_can_be_configured_without_side_effects(self):
        path = Path(__file__).resolve().parents[1] / "config" / "config.py"
        configured = Path(self.temporary.name) / "not-created" / "activity.sqlite3"
        with patch.dict(os.environ, {
            "OFFLINE_QUEUE_PATH": str(configured),
            "OFFLINE_QUEUE_RETENTION_DAYS": "3",
            "OFFLINE_QUEUE_MAX_RECORDS": "12",
            "OFFLINE_QUEUE_MAX_BYTES": "4096",
        }, clear=True):
            settings = runpy.run_path(str(path))
        self.assertEqual(settings["OFFLINE_QUEUE_PATH"], configured)
        self.assertEqual(settings["OFFLINE_QUEUE_RETENTION_DAYS"], 3)
        self.assertEqual(settings["OFFLINE_QUEUE_MAX_RECORDS"], 12)
        self.assertEqual(settings["OFFLINE_QUEUE_MAX_BYTES"], 4096)
        self.assertFalse(configured.parent.exists())


if __name__ == "__main__":
    unittest.main()
