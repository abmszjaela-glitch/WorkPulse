"""Device-authenticated interval uploads on a separate interruptible worker.

The existing backend atomically stores application durations with /activity/batch.
Only exact, acknowledged record IDs are removed from the encrypted SQLite queue.
No passwords, key values, window titles, URLs or screenshots are accepted here.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Lock, Thread
from time import monotonic, time
from uuid import UUID
import re
import hashlib
import json

from ..auth.client import WorkPulseAuthClient, AuthenticationError
from ..auth.device_store import DeviceCredentialStore, DeviceCredentials
from ..config import config
from ..utils.logger import get_logger
from .offline_queue import OfflineQueue
from .remote_policy import RemoteWorkingHours


@dataclass
class DeviceToken:
    token: str = field(repr=False)
    expires_at: float
    device_id: str


class DataSender:
    def __init__(self, authentication, *, api=None, store_factory=DeviceCredentialStore, queue_factory=OfflineQueue):
        self._authentication = authentication
        self._api = api or WorkPulseAuthClient()
        self._store_factory, self._queue_factory = store_factory, queue_factory
        self._lock = Lock()
        self._stop, self._wake = Event(), Event()
        self._thread = None
        self._owner = self._device = self._token = self._queue = None
        self._activation = None
        self._accept = False
        self._wanted_status = "PAUSED"
        self._remote = None
        self._policy = None
        self._state = dict(ready=False, message="Sign in to connect this device.", policy_content="", policy_version=None,
                           consent_accepted=False, pending=0, last_sync="Never", offline=False)

    def snapshot(self):
        with self._lock:
            return dict(self._state)

    def _update(self, **values):
        with self._lock:
            self._state.update(values)

    def can_record(self, owner):
        if self._authentication.tracking_identity() != owner:
            return False
        with self._lock:
            return (self._owner == owner and self._state["ready"] and self._state["consent_accepted"]
                    and self._policy is not None and self._queue is not None)

    def notify_auth_changed(self):
        self._wake.set()

    def tracking_settings(self):
        with self._lock:
            return dict(self._remote or {})

    def working_policy(self):
        with self._lock:
            return self._policy

    def start(self):
        if self._thread is None:
            self._thread = Thread(target=self._run, name="WorkPulse device synchronization", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=config.AUTH_CONNECT_TIMEOUT + config.AUTH_READ_TIMEOUT + 2)

    def activate(self, value):
        activation = self.parse_activation(value)
        with self._lock:
            self._activation = activation
            self._state.update(ready=False, message="Connecting securely…")
        self._wake.set()

    @staticmethod
    def parse_activation(value):
        parts = value.strip().split(".")
        if len(parts) != 3 or parts[0] != "wp1" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", parts[2]):
            raise ValueError("Enter the activation code supplied by your administrator.")
        UUID(parts[1])
        return parts[1], parts[2]

    def accept_consent(self):
        with self._lock:
            self._accept = True
        self._wake.set()

    def set_status(self, status):
        if status not in ("ACTIVE", "IDLE", "PAUSED", "OFFLINE"):
            raise ValueError("Invalid tracking status.")
        with self._lock:
            if status == self._wanted_status:
                return
            self._wanted_status = status
        self._wake.set()

    def enqueue(self, start, end, summary, *, owner):
        # Reporting thread only, never an input listener. The queue is thread-safe.
        with self._lock:
            queue, current_owner = self._queue, self._owner
        # The core authorization gate controls collection. A final authorized
        # interval must still be queued if consent changes or logout occurs
        # while its listeners stop. The backend validates historical consent.
        if queue is None or owner is None or owner != current_owner:
            raise RuntimeError("Authorized device storage is not ready.")
        queue.enqueue(owner, start, end, summary)
        self._update(pending=queue.get_statistics()["pending"])
        self._wake.set()

    def _request(self, method, path, body=None):
        if self._stop.is_set() or self._authentication.tracking_identity() != self._owner:
            raise AuthenticationError("expired")
        return self._api._request(method, path, token=self._token.token, body=body)

    def _issue(self, device):
        result = self._api._request("POST", "/devices/token", body={"deviceId": device.device_id, "deviceCredential": device.credential})
        token = self._validated_token(result, device.device_id)
        me = self._api._request("GET", "/auth/me", token=token.token)
        if (me.get("role") != "Agent" or me.get("deviceId") != device.device_id
                or me.get("user", {}).get("id") != self._owner
                or self._authentication.tracking_identity() != self._owner or self._stop.is_set()):
            self._api.logout(token.token)
            raise AuthenticationError("invalid_credentials")
        return token

    @staticmethod
    def _validated_token(result, device_id):
        seconds = result.get("expiresIn")
        if (not isinstance(result.get("accessToken"), str) or not result["accessToken"]
                or type(seconds) not in (int, float) or not 0 < seconds <= 86400
                or result.get("tokenType") != "Bearer"):
            raise AuthenticationError("invalid_response")
        return DeviceToken(result["accessToken"], time() + seconds, device_id)

    def _connect(self, owner, activation):
        self._owner = owner
        store = self._store_factory(self._api.server_url, owner)
        device = DeviceCredentials(owner, *activation) if activation else store.load()
        if device is None:
            self._update(ready=False, message="Connect this device using an activation code from your administrator.")
            return False
        self._token = self._issue(device)
        if activation:
            result = self._request("POST", "/devices/register", {"name": "WorkPulse Agent", "platform": "Windows",
                                                                    "deviceCredential": device.credential})
            if result.get("device", {}).get("user_id") != owner or result["device"]["id"] != device.device_id:
                raise AuthenticationError("invalid_response")
            device = DeviceCredentials(owner, device.device_id, result["deviceCredential"])
            store.save(device)  # No insecure fallback after credential rotation.
            self._token = self._validated_token(result, device.device_id)
        self._device = device
        if activation and self._queue is not None:
            self._queue.close()
            self._queue = None
        self._load_policy()
        if self._queue is None:
            if config.OFFLINE_QUEUE_PATH is None:
                raise RuntimeError("Offline storage is unavailable.")
            path = Path(config.OFFLINE_QUEUE_PATH)
            server_scope = hashlib.sha256(self._api.server_url.encode()).hexdigest()[:24]
            self._queue = self._queue_factory(database_path=path.parent / server_scope / owner / device.device_id / path.name,
                                              retention_days=self._remote.get("offlineDays", config.OFFLINE_QUEUE_RETENTION_DAYS))
        self._update(pending=self._queue.get_statistics()["pending"])
        return True

    def _load_policy(self):
        remote = self._request("GET", "/devices/agent-config")
        policy = RemoteWorkingHours(remote["workingHours"])
        document = self._request("GET", "/consent/policy")
        if document.get("version") != remote.get("policyVersion"):
            raise AuthenticationError("invalid_response")
        # Presence timestamps/status change on every heartbeat and are NOT policy.
        policy_values = {key: remote.get(key) for key in ("idleThreshold", "trackingInterval", "syncInterval", "workingHours",
                         "trackApplications", "trackKeyboardCounts", "trackMouseCounts", "offlineDays", "policyVersion")}
        with self._lock:
            changed = self._remote is not None and any(self._remote.get(key) != value for key, value in policy_values.items())
            self._remote, self._policy = remote, policy
        self._update(ready=True, message="Device connected." if not changed else "Policy updated. Restart tracking explicitly if it was paused.",
                     policy_content=document["content"], policy_version=document["version"],
                     policy_key=hashlib.sha256(json.dumps(policy_values, sort_keys=True).encode()).hexdigest(),
                     consent_accepted=remote.get("consentAccepted") is True, offline=False)

    def send_pending(self):
        records = self._queue.retrieve_pending(limit=min(config.SYNC_BATCH_SIZE, 100))
        if not records:
            return
        bounded, size = [], 2  # JSON array brackets; requests uses standard JSON.
        for record in records:
            cost = len(json.dumps(record, allow_nan=False).encode("utf-8")) + (2 if bounded else 0)
            if size + cost > config.SYNC_MAX_BATCH_BYTES:
                if not bounded:
                    raise RuntimeError("An aggregate record exceeds the configured upload limit.")
                break
            bounded.append(record)
            size += cost
        records = bounded
        if any(record["employee_id"] != self._owner for record in records):
            raise RuntimeError("Queued employee identity does not match this device.")
        response = self._request("POST", "/activity/batch", records)
        acknowledgements = response.get("acknowledged_record_ids")
        results = response.get("results")
        sent = {record["record_id"] for record in records}
        if (not isinstance(acknowledgements, list) or not isinstance(results, list)
                or any(value not in sent for value in acknowledgements)):
            raise AuthenticationError("invalid_response")
        confirmed = {item.get("record_id") for item in results if isinstance(item, dict) and item.get("status") in ("accepted", "duplicate")}
        if set(acknowledgements) != confirmed or not confirmed <= sent:
            raise AuthenticationError("invalid_response")
        if confirmed:
            self._queue.mark_synchronized(confirmed)
            self._queue.delete_synchronized(confirmed)
            self._update(last_sync=datetime.now(timezone.utc).isoformat(), offline=False)
            get_logger().info("sync_succeeded")
        self._update(pending=self._queue.get_statistics()["pending"])
        if len(confirmed) != len(records):
            self._update(message="Some records were rejected by the server and remain queued. Check the monitoring schema, consent and device policy.")

    def _run(self):
        failures, due, heartbeat_due, policy_due = 0, 0.0, 0.0, 0.0
        sent_status = None
        try:
            while not self._stop.is_set():
                owner = self._authentication.tracking_identity()
                if owner is None:
                    # Logout stops collection immediately. Reporting PAUSED with
                    # the existing device JWT does not upload any employee data.
                    if self._token is not None and sent_status != "PAUSED":
                        try:
                            self._api._request("POST", "/status", token=self._token.token, body={"status": "PAUSED"})
                            sent_status = "PAUSED"
                        except Exception:
                            pass  # Offline heartbeat expiry remains authoritative.
                    self._update(ready=False, consent_accepted=False, message="Sign in to connect this device.")
                    self._wake.wait(1)
                    self._wake.clear()
                    continue
                try:
                    with self._lock:
                        activation, self._activation = self._activation, None
                    if owner != self._owner:
                        if self._queue:
                            self._queue.close()
                        self._queue = self._device = self._token = self._remote = self._policy = None
                        sent_status = None
                    if self._device is None or self._queue is None or activation:
                        if not self._connect(owner, activation):
                            self._wake.wait(60)
                            self._wake.clear()
                            continue
                        due = heartbeat_due = policy_due = 0
                    if self._token.expires_at - time() < 30:
                        self._token = self._issue(self._device)
                    now = monotonic()
                    if now >= policy_due:
                        self._load_policy()
                        policy_due = now + 60
                    with self._lock:
                        accept, self._accept = self._accept, False
                        wanted = self._wanted_status
                    if accept:
                        self._request("POST", "/consent/accept", {"policyVersion": self.snapshot()["policy_version"]})
                        self._load_policy()
                    if now >= heartbeat_due:
                        self._request("POST", "/devices/heartbeat")
                        heartbeat_due = now + config.HEARTBEAT_INTERVAL
                    if wanted != sent_status and (wanted in ("PAUSED", "OFFLINE") or self.snapshot()["consent_accepted"]):
                        self._request("POST", "/status", {"status": wanted})
                        sent_status = wanted
                    if now >= due:
                        self.send_pending()
                        due = now + max(1, self.tracking_settings().get("syncInterval", config.SYNC_INTERVAL))
                    failures = 0
                    self._update(offline=False)
                    self._wake.wait(max(0.2, min(due, heartbeat_due, policy_due) - monotonic()))
                except AuthenticationError as error:
                    failures += 1
                    if error.code in ("invalid_credentials", "expired"):
                        self._update(ready=False, message="Device authorization failed. Ask your administrator to check this device.")
                        self._token = None
                        self._device = None
                    else:
                        self._update(offline=True, message=str(error))
                    get_logger().warning("sync_failed")
                    self._wake.wait(min(config.SYNC_RETRY_MAX, config.SYNC_RETRY_BASE * 2 ** min(failures - 1, 8)))
                except Exception:
                    self._update(ready=False, message="Device synchronization could not initialize. Check secure storage, activation and backend database setup.")
                    get_logger().warning("sync_failed")
                    self._wake.wait(config.SYNC_RETRY_MAX)
                self._wake.clear()
        finally:
            if self._queue:
                self._queue.close()
