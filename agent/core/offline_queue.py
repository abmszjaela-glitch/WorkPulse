"""Explicit, bounded SQLite storage of Windows-encrypted aggregate activity.

No database is opened on import and no network requests are made. A sync client
must send record_id as its idempotency key and acknowledge only server-confirmed
IDs. Server-side ID uniqueness is necessary for retries after lost responses.
"""

from __future__ import annotations

import hmac
import json
import sqlite3
import time
from contextlib import contextmanager, suppress
from pathlib import Path
from threading import RLock
from uuid import NAMESPACE_URL, UUID, uuid5

from .activity_record import canonical_record
from .queue_errors import (
    QueueConflictError, QueueError, QueueFullError, QueueRetentionError,
    QueueSecurityError, QueueValidationError,
)
from .windows_queue_security import WindowsQueueSecurity

if __package__ == "core":
    from config import config
else:
    from ..config import config


def _limit(value, name: str) -> int:
    if type(value) is not int or not 0 < value <= 2**63 - 1:
        raise QueueValidationError(f"{name} must be a positive bounded integer.")
    return value


def _record_id(value) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise QueueValidationError("Record IDs must be valid UUIDs.") from None


class OfflineQueue:
    """Thread-safe queue with pending/synced states and durable acknowledgments.

    Pending records are never evicted to make room: capacity rejects new inserts.
    Explicit retention expiration is the only automatic pending-data removal.
    Payloads are encrypted with current-user DPAPI before entering SQLite. Schema
    metadata holds UUIDs, timestamps, hashes and sync state, not employee details.
    """

    def __init__(
        self, database_path: str | Path | None = None, *,
        retention_days: int | None = None, max_records: int | None = None,
        max_bytes: int | None = None, max_record_bytes: int | None = None,
    ) -> None:
        selected_path = config.OFFLINE_QUEUE_PATH if database_path is None else database_path
        if selected_path is None:
            raise QueueSecurityError("Set OFFLINE_QUEUE_PATH when LOCALAPPDATA is unavailable.")
        self.database_path = Path(selected_path).expanduser().absolute()
        if str(self.database_path).startswith("\\\\"):
            raise QueueValidationError("Offline queue must use a local filesystem path.")
        self._retention = _limit(
            config.OFFLINE_QUEUE_RETENTION_DAYS if retention_days is None else retention_days,
            "Queue retention days",
        ) * 86400
        self._max_records = _limit(
            config.OFFLINE_QUEUE_MAX_RECORDS if max_records is None else max_records,
            "Queue record limit",
        )
        self._max_bytes = _limit(
            config.OFFLINE_QUEUE_MAX_BYTES if max_bytes is None else max_bytes,
            "Queue byte limit",
        )
        self._max_record_bytes = _limit(
            config.OFFLINE_QUEUE_MAX_RECORD_BYTES if max_record_bytes is None else max_record_bytes,
            "Queue record byte limit",
        )
        self._lock = RLock()
        self._connection: sqlite3.Connection | None = None
        self._security = WindowsQueueSecurity()
        self._security.prepare(self.database_path)
        try:
            connection = sqlite3.connect(
                str(self.database_path), timeout=config.OFFLINE_QUEUE_DB_TIMEOUT,
                isolation_level=None, check_same_thread=False,
            )
            self._connection = connection
            connection.row_factory = sqlite3.Row
            # Rollback journals inherit the protected directory ACL. No plaintext
            # payload, employee ID or app name is ever bound to an SQL statement.
            connection.execute("PRAGMA journal_mode=DELETE")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA secure_delete=ON")
            connection.execute("PRAGMA temp_store=MEMORY")
            application_id = connection.execute("PRAGMA application_id").fetchone()[0]
            if application_id not in (0, 1464881457):
                raise QueueError("Database belongs to another application.")
            if application_id == 0 and connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            ).fetchone()[0]:
                raise QueueError("Existing database is not an offline activity queue.")
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise QueueError("Unsupported offline queue schema version.")
            connection.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS activity_records (
                    record_id TEXT PRIMARY KEY,
                    interval_key BLOB NOT NULL UNIQUE,
                    content_hash BLOB NOT NULL,
                    payload BLOB NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    sync_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(sync_status IN ('pending', 'synced')),
                    synced_at REAL
                );
                CREATE INDEX IF NOT EXISTS activity_records_pending
                    ON activity_records(sync_status, created_at, record_id);
                CREATE INDEX IF NOT EXISTS activity_records_expiry
                    ON activity_records(expires_at);
                CREATE TABLE IF NOT EXISTS sync_receipts (
                    record_id TEXT PRIMARY KEY,
                    interval_key BLOB NOT NULL UNIQUE,
                    content_hash BLOB NOT NULL,
                    acknowledged_at REAL NOT NULL
                );
                PRAGMA user_version=1;
                PRAGMA application_id=1464881457;
                COMMIT;
            """)
            self.prune_expired()
        except (sqlite3.Error, QueueError):
            if self._connection is not None:
                with suppress(sqlite3.Error):
                    self._connection.close()
            self._connection = None
            raise QueueError("Offline queue database could not be initialized safely.") from None

    @contextmanager
    def _transaction(self):
        with self._lock:
            connection = self._connection
            if connection is None:
                raise QueueError("Offline queue is closed.")
            try:
                connection.execute("BEGIN IMMEDIATE")
                yield connection
                connection.execute("COMMIT")
            except BaseException as error:
                with suppress(sqlite3.Error):
                    if connection.in_transaction:
                        connection.execute("ROLLBACK")
                if isinstance(error, sqlite3.Error):
                    raise QueueError("Offline queue database operation failed.") from None
                raise

    def _prune(self, connection, now: float) -> int:
        removed = connection.execute(
            "DELETE FROM activity_records WHERE expires_at <= ?", (now,)
        ).rowcount
        connection.execute(
            "DELETE FROM sync_receipts WHERE acknowledged_at <= ?", (now - self._retention,)
        )
        # Receipts retain no payload and are also bounded. They are only a local
        # deduplication window; the backend must enforce permanent idempotency.
        connection.execute("""
            DELETE FROM sync_receipts WHERE record_id IN (
                SELECT record_id FROM sync_receipts
                ORDER BY acknowledged_at DESC, record_id DESC LIMIT -1 OFFSET ?
            )
        """, (self._max_records,))
        return removed

    def enqueue(
        self, employee_id: str, interval_start, interval_end, summary: dict, *,
        record_id: str | None = None,
    ) -> str:
        """Persist one aggregate interval and return its stable UUID.

        Exact retries return the existing ID, including after acknowledged records
        have been deleted while a receipt remains. Different data for the same
        employee/interval or ID raises QueueConflictError instead of overwriting.
        """
        body, interval_key, content_hash, ended_at = canonical_record(
            employee_id, interval_start, interval_end, summary
        )
        if len(body) > self._max_record_bytes:
            raise QueueFullError("Aggregate activity record exceeds the payload size limit.")
        requested_id = _record_id(record_id) if record_id is not None else None
        now = time.time()
        expires_at = min(now, ended_at) + self._retention
        if expires_at <= now:
            raise QueueRetentionError("Activity interval is already outside queue retention.")
        with self._transaction() as connection:
            self._prune(connection, now)
            for table in ("activity_records", "sync_receipts"):
                # Table names are fixed source literals; every external value is
                # passed through SQLite parameters, never interpolated into SQL.
                existing = connection.execute(
                    f"SELECT record_id, content_hash FROM {table} WHERE interval_key = ?",
                    (interval_key,),
                ).fetchone()
                if requested_id is not None and existing is None:
                    existing = connection.execute(
                        f"SELECT record_id, content_hash FROM {table} WHERE record_id = ?",
                        (requested_id,),
                    ).fetchone()
                if existing is not None:
                    if (not hmac.compare_digest(existing["content_hash"], content_hash)
                            or requested_id is not None and requested_id != existing["record_id"]):
                        raise QueueConflictError("Record ID or interval conflicts with queued data.")
                    return existing["record_id"]
            # Deterministic defaults keep the same idempotency key even after a
            # local receipt expires. Explicit caller IDs must likewise be reused.
            identifier = requested_id or str(uuid5(
                NAMESPACE_URL, "workpulse:activity-interval:" + interval_key.hex()
            ))
            envelope = {"record_id": identifier, **json.loads(body)}
            plaintext = json.dumps(envelope, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
            encrypted = self._security.protect(plaintext)
            count, size = connection.execute(
                "SELECT COUNT(*), COALESCE(SUM(LENGTH(payload)), 0) FROM activity_records"
            ).fetchone()
            if count >= self._max_records or size + len(encrypted) > self._max_bytes:
                raise QueueFullError("Offline queue is full; pending records were retained.")
            connection.execute("""
                INSERT INTO activity_records
                    (record_id, interval_key, content_hash, payload, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (identifier, interval_key, content_hash, encrypted, now, expires_at))
            return identifier

    def _decode(self, row) -> dict:
        plaintext = self._security.unprotect(row["payload"])
        try:
            envelope = json.loads(plaintext)
            if (not isinstance(envelope, dict) or set(envelope) != {
                    "record_id", "employee_id", "interval_start", "interval_end", "summary"
                    } or envelope["record_id"] != row["record_id"]):
                raise ValueError
            _, key, digest, _ = canonical_record(
                envelope["employee_id"], envelope["interval_start"],
                envelope["interval_end"], envelope["summary"],
            )
            if (not hmac.compare_digest(digest, row["content_hash"])
                    or not hmac.compare_digest(key, row["interval_key"])):
                raise ValueError
        except (ValueError, TypeError, KeyError, QueueValidationError):
            raise QueueSecurityError("Queued record integrity validation failed.") from None
        envelope["sync_status"] = row["sync_status"]
        return envelope

    def retrieve_pending(self, limit: int = 100) -> list[dict]:
        """Read oldest pending records without acknowledging/deleting them.

        An upload failure requires no queue mutation: retries use these same IDs.
        This is not a leasing API; use one uploader and server-side idempotency.
        """
        _limit(limit, "Queue retrieval limit")
        with self._transaction() as connection:
            self._prune(connection, time.time())
            rows = connection.execute("""
                SELECT * FROM activity_records WHERE sync_status = ?
                ORDER BY created_at, record_id LIMIT ?
            """, ("pending", min(limit, self._max_records))).fetchall()
        return [self._decode(row) for row in rows]

    @staticmethod
    def _ids(record_ids) -> tuple[str, ...]:
        values = (record_ids,) if isinstance(record_ids, str) else record_ids
        try:
            return tuple(dict.fromkeys(_record_id(value) for value in values))
        except TypeError:
            raise QueueValidationError("Provide a UUID or an iterable of UUIDs.") from None

    def mark_synchronized(self, record_ids) -> int:
        """Acknowledge only IDs confirmed by the backend; idempotent on retry."""
        identifiers = self._ids(record_ids)
        with self._transaction() as connection:
            now = time.time()
            self._prune(connection, now)
            updated = 0
            for identifier in identifiers:
                row = connection.execute(
                    "SELECT * FROM activity_records WHERE record_id = ?", (identifier,)
                ).fetchone()
                if row is None:
                    continue
                connection.execute("""
                    INSERT OR IGNORE INTO sync_receipts
                        (record_id, interval_key, content_hash, acknowledged_at)
                    VALUES (?, ?, ?, ?)
                """, (identifier, row["interval_key"], row["content_hash"], now))
                updated += connection.execute("""
                    UPDATE activity_records SET sync_status = ?, synced_at = ?
                    WHERE record_id = ? AND sync_status = ?
                """, ("synced", now, identifier, "pending")).rowcount
            self._prune(connection, now)
            return updated

    def delete_synchronized(self, record_ids=None) -> int:
        """Delete acknowledged payloads only; retain bounded deduplication receipts."""
        identifiers = None if record_ids is None else self._ids(record_ids)
        with self._transaction() as connection:
            if identifiers is None:
                return connection.execute(
                    "DELETE FROM activity_records WHERE sync_status = ?", ("synced",)
                ).rowcount
            return sum(connection.execute(
                "DELETE FROM activity_records WHERE record_id = ? AND sync_status = ?",
                (identifier, "synced"),
            ).rowcount for identifier in identifiers)

    def prune_expired(self) -> int:
        """Enforce the explicit retention policy, including expired pending records."""
        with self._transaction() as connection:
            return self._prune(connection, time.time())

    def get_statistics(self) -> dict[str, int]:
        with self._transaction() as connection:
            self._prune(connection, time.time())
            counts = dict(connection.execute(
                "SELECT sync_status, COUNT(*) FROM activity_records GROUP BY sync_status"
            ).fetchall())
            size = connection.execute(
                "SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM activity_records"
            ).fetchone()[0]
        return {"pending": counts.get("pending", 0), "synced": counts.get("synced", 0), "payload_bytes": size}

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                try:
                    self._connection.close()
                except sqlite3.Error:
                    raise QueueError("Offline queue could not be closed cleanly.") from None
                self._connection = None

    def __enter__(self):
        return self

    def __exit__(self, _type, _value, _traceback):
        self.close()
