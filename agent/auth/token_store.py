"""Windows-only token storage. This module does NOT verify JWT signatures.

Only an authentication adapter using the real backend contract may call save()
after verifying the token/session and obtaining its authoritative expiry. Loading
a token from this cache must not itself grant access or start activity tracking.
No passwords, refresh tokens, identity profiles or plaintext files are stored.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from dataclasses import dataclass, field

import pywintypes
import win32cred
import winerror


class TokenStorageError(RuntimeError):
    """A sanitized Windows token-storage error, without credential details."""


@dataclass(frozen=True)
class StoredAccessToken:
    """Cached secret and expiry only; never represents verified authentication."""

    token: str = field(repr=False)
    expires_at: float

    @property
    def is_expired(self) -> bool:
        return time.time() >= self.expires_at


class WindowsTokenStore:
    """Store a server-scoped access-token cache in Windows Credential Manager.

    Current-user local-machine persistence survives application/Windows restarts
    on this computer; it does not make the credential readable to other users.
    Use clear() on local logout. Server-side logout/revocation is a separate API
    operation which cannot be implemented without the actual backend contract.
    """

    # Win32 CREDENTIALW's documented CRED_MAX_CREDENTIAL_BLOB_SIZE, in bytes.
    # Exceeding it fails closed; there is no plaintext file fallback.
    _MAX_BLOB_BYTES = 5 * 512

    def __init__(self, server_url: str, *, namespace: str = "WorkPulseAgent.AccessToken") -> None:
        if not isinstance(server_url, str) or not server_url.strip():
            raise ValueError("A backend identity is required for token storage.")
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", namespace):
            raise ValueError("Invalid agent credential namespace.")
        identity = server_url.strip().rstrip("/")
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        self._target = namespace + "." + digest

    @staticmethod
    def _validate(token, expires_at) -> None:
        # Shape checks only, not JWT signature/issuer/audience verification.
        if (not isinstance(token, str) or not token
                or any(ord(character) < 33 or ord(character) > 126 for character in token)):
            raise ValueError("Access token must be a non-empty printable token string.")
        if (type(expires_at) not in (int, float) or not math.isfinite(expires_at)
                or expires_at <= 0):
            raise ValueError("Access token expiry must be a finite Unix timestamp.")

    def save(self, token: str, expires_at: float) -> None:
        """Cache an already-verified token; never accept/store a password."""
        self._validate(token, expires_at)
        if expires_at <= time.time():
            raise ValueError("Expired access tokens must not be stored.")
        payload = json.dumps(
            {"version": 1, "access_token": token, "expires_at": float(expires_at)},
            separators=(",", ":"), allow_nan=False,
        )
        # pywin32 CredWrite accepts Unicode and stores its UTF-16LE bytes.
        if len(payload.encode("utf-16-le")) > self._MAX_BLOB_BYTES:
            raise TokenStorageError("Access token exceeds Windows credential storage capacity.")
        try:
            win32cred.CredWrite({
                "Type": win32cred.CRED_TYPE_GENERIC,
                "TargetName": self._target,
                "UserName": "WorkPulse Agent",
                "CredentialBlob": payload,
                "Persist": win32cred.CRED_PERSIST_LOCAL_MACHINE,
            }, 0)
        except pywintypes.error:
            raise TokenStorageError("Windows Credential Manager could not store the access token.") from None

    def load(self) -> StoredAccessToken | None:
        """Load a cache entry, clearing expired or malformed data securely.

        The caller must still verify the session against the backend's actual
        authentication rules. This method never decodes/trusts JWT claims.
        """
        try:
            credential = win32cred.CredRead(self._target, win32cred.CRED_TYPE_GENERIC, 0)
        except pywintypes.error as error:
            if error.winerror == winerror.ERROR_NOT_FOUND:
                return None
            raise TokenStorageError("Windows Credential Manager could not read the access token.") from None
        try:
            blob = credential["CredentialBlob"]
            if isinstance(blob, bytes):
                blob = blob.decode("utf-16-le")
            payload = json.loads(blob)
            if (not isinstance(payload, dict) or set(payload) != {
                    "version", "access_token", "expires_at"} or payload["version"] != 1):
                raise ValueError
            self._validate(payload["access_token"], payload["expires_at"])
        except (KeyError, TypeError, ValueError, UnicodeError):
            self.clear()
            raise TokenStorageError("Invalid cached access token was removed.") from None
        stored = StoredAccessToken(payload["access_token"], payload["expires_at"])
        if stored.is_expired:
            self.clear()
            return None
        return stored

    def clear(self) -> None:
        """Delete only this agent/server's cache entry; idempotent on logout."""
        try:
            win32cred.CredDelete(self._target, win32cred.CRED_TYPE_GENERIC, 0)
        except pywintypes.error as error:
            if error.winerror != winerror.ERROR_NOT_FOUND:
                raise TokenStorageError("Windows Credential Manager could not remove the access token.") from None
