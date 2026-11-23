"""Thread-safe employee session state; HTTP/credential operations run off Tk.

No background thread is created here. The existing tray control worker executes
jobs. Generations prevent a late login response from undoing logout or shutdown.
"""
from dataclasses import dataclass, field
from threading import Lock
from time import time

from .client import AuthenticationError, MESSAGES, WorkPulseAuthClient
from .token_store import TokenStorageError
from ..utils.logger import get_logger


@dataclass(frozen=True)
class AuthJob:
    generation: int
    action: str
    values: tuple = field(default=(), repr=False)


class AgentAuthentication:
    def __init__(self, store, *, client=None, clock=time):
        self._store = store
        self._client = client or WorkPulseAuthClient()
        self._clock = clock
        self._lock = Lock()
        self._generation = 0
        self._session = None
        self._revocations = []
        self._state = "signed_out"
        self._message = "Sign in with your registered employee account."

    def snapshot(self):
        with self._lock:
            return {"state": self._state, "message": self._message,
                    "email": self._session.email if self._session else "",
                    "user_id": self._session.user_id if self._session else None,
                    "signed_in": self._tracking_identity() is not None,
                    "revision": self._generation}

    def _tracking_identity(self):
        """Caller holds _lock. An expired or restricted session grants nothing."""
        if (self._state == "signed_in" and self._session is not None
                and not self._session.must_change_password
                and self._clock() < self._session.expires_at):
            return self._session.user_id
        return None

    def tracking_identity(self):
        """Return a verified, currently valid employee ID, never a cached claim."""
        with self._lock:
            return self._tracking_identity()

    def begin(self, action, *values):
        with self._lock:
            if self._state in ("signing_in", "checking_session", "changing_password"):
                return None
            if action == "change_password" and self._state != "password_required":
                return None
            if action in ("login", "restore") and self._session:
                return None
            if action not in ("login", "restore", "change_password"):
                raise ValueError("Unsupported authentication action.")
            self._generation += 1
            self._state = {"login": "signing_in", "restore": "checking_session", "change_password": "changing_password"}[action]
            self._message = "Updating password…" if action == "change_password" else "Verifying your session…"
            return AuthJob(self._generation, action, values)

    def cancel(self):
        """Immediate in-memory logout; no network or disk work on the UI thread."""
        with self._lock:
            self._generation += 1
            if self._session:
                self._revocations.append(self._session.token)
            self._session = None
            self._state = "signed_out"
            self._message = "Signed out. Tracking is paused."

    def logout(self):
        """Worker only, after listeners stop. Local removal precedes HTTP."""
        self.cancel()
        try:
            self._store.clear()
        except TokenStorageError:
            with self._lock:
                self._message = "Signed out locally, but Windows could not remove the cached token. Check Credential Manager."
            get_logger().error("auth_storage_error")
        with self._lock:
            tokens, self._revocations = self._revocations, []
        confirmed = all([self._client.logout(token) for token in tokens])
        if not confirmed:
            with self._lock:
                self._message = "Signed out locally. Server logout could not be confirmed; the session expires under backend policy."
        get_logger().info("auth_signed_out")

    def expire(self):
        """Worker tick; return true once so the controller can pause listeners."""
        with self._lock:
            expired = self._session is not None and self._clock() >= self._session.expires_at
        if expired:
            # The expired bearer is already unusable. Do not wait on HTTP before
            # telling the controller to stop listeners.
            self.cancel()
            try:
                self._store.clear()
            except TokenStorageError:
                get_logger().error("auth_storage_error")
            with self._lock:
                self._message = MESSAGES["expired"]
                self._revocations.clear()
            return True
        return False

    def perform(self, job):
        verified = None
        with self._lock:
            if job.generation != self._generation:
                return
            current = self._session
        try:
            if job.action == "change_password":
                self._client.change_password(current.token, *job.values)
                self.logout()  # Password changes revoke all sessions in the backend.
                with self._lock:
                    self._message = "Password updated. Sign in again with your new password."
                get_logger().info("auth_password_changed")
                return
            if job.action == "restore":
                stored = self._store.load()
                if stored is None:
                    with self._lock:
                        if job.generation == self._generation:
                            self._state = "signed_out"
                            self._message = "Sign in with your registered employee account."
                    return
                verified = self._client.verify(stored.token, stored.expires_at)
            else:
                # Explicit sign-in must not leave an older cached identity to
                # reappear after a failed login or a temporary-password flow.
                self._store.clear()
                verified = self._client.login(*job.values)
            with self._lock:
                if job.generation == self._generation:
                    if not verified.must_change_password:
                        # Small local Win32 operation, serialized with logout.
                        self._store.save(verified.token, verified.expires_at)
                    self._session = verified
                    self._state = "password_required" if verified.must_change_password else "signed_in"
                    self._message = ("Change your temporary password before using this account."
                                     if verified.must_change_password else "Signed in. Tracking remains paused until explicitly authorized.")
                    get_logger().info("auth_signed_in")
                    return
            self._client.logout(verified.token)  # Cancelled while HTTP was in progress.
        except Exception as error:
            code = error.code if isinstance(error, AuthenticationError) else ("storage" if isinstance(error, TokenStorageError) else "unexpected")
            if verified:
                self._client.logout(verified.token)
            if job.action == "restore" and code in ("invalid_credentials", "expired", "invalid_response"):
                try:
                    self._store.clear()
                except TokenStorageError:
                    code = "storage"
            with self._lock:
                if job.generation == self._generation:
                    self._state = "password_required" if current else "signed_out"
                    self._message = MESSAGES[code]
            get_logger().warning("auth_failed")
