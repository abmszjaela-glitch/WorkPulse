"""Adapter for the existing custom-JWT WorkPulse /api/v1/auth contract.

JWT verification belongs to GET /auth/me on the trusted server. No signing
secret is distributed to the agent and unverified decoded claims grant nothing.
Employee tokens are never treated as device credentials or used to upload data.
"""
from dataclasses import dataclass, field
from math import isfinite
from time import time
from urllib.parse import urlsplit

import requests

from ..config import config


MESSAGES = {
    "invalid_credentials": "Invalid email or password, or the account is disabled/expired.",
    "network": "Unable to reach WorkPulse. Check that the backend is running and SERVER_URL is correct.",
    "configuration": "Use an HTTPS backend URL, or HTTP on localhost for development. The API base must end with /api/v1.",
    "unavailable": "Authentication is unavailable. Ask your administrator to check the backend configuration.",
    "rate_limit": "Too many sign-in attempts. Please wait before trying again.",
    "invalid_fields": "Check your password and fields. New passwords need 12–72 bytes, uppercase, lowercase, a number and a symbol, and must differ from the current password.",
    "invalid_response": "The backend returned an invalid authentication response. Check the API configuration.",
    "storage": "Windows Credential Manager is unavailable. Sign-in could not be saved securely.",
    "expired": "Your session expired. Sign in again; tracking has been paused.",
    "unexpected": "Sign-in could not be completed. Please try again.",
}


class AuthenticationError(RuntimeError):
    """Fixed feedback categories only; raw HTTP bodies/credentials never escape."""
    def __init__(self, code):
        self.code = code if code in MESSAGES else "unexpected"
        super().__init__(MESSAGES[self.code])


@dataclass(frozen=True)
class VerifiedSession:
    token: str = field(repr=False)
    expires_at: float
    user_id: str = field(repr=False)
    email: str = field(repr=False)
    role: str
    must_change_password: bool


class WorkPulseAuthClient:
    def __init__(self, server_url=None, *, transport=None, clock=time):
        self.server_url = (server_url or config.SERVER_URL).rstrip("/")
        self._transport = transport or requests
        self._clock = clock

    def _request(self, method, path, *, token=None, body=None):
        parsed = urlsplit(self.server_url)
        # TLS for remote credentials; local development is explicitly allowed.
        if (parsed.scheme not in ("https", "http") or not parsed.hostname
                or (parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"))
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or not parsed.path.rstrip("/").endswith("/api/v1")):
            raise AuthenticationError("configuration")
        try:
            response = self._transport.request(
                method, self.server_url + path, json=body,
                headers={"Accept": "application/json", **({"Authorization": "Bearer " + token} if token else {})},
                timeout=(config.AUTH_CONNECT_TIMEOUT, config.AUTH_READ_TIMEOUT),
                allow_redirects=False,
            )
        except requests.RequestException:
            raise AuthenticationError("network") from None
        try:
            if response.status_code in (401, 403):
                raise AuthenticationError("invalid_credentials")
            if response.status_code == 429:
                raise AuthenticationError("rate_limit")
            if response.status_code in (400, 422):
                raise AuthenticationError("invalid_fields")
            if response.status_code >= 500:
                raise AuthenticationError("unavailable")
            if response.status_code not in (200, 204):
                raise AuthenticationError("invalid_response")
            if response.status_code == 204:
                return None
            try:
                result = response.json()
            except ValueError:
                raise AuthenticationError("invalid_response") from None
            if not isinstance(result, dict):
                raise AuthenticationError("invalid_response")
            return result
        finally:
            response.close()

    def verify(self, token, expires_at):
        if not isinstance(token, str) or not token or "\n" in token or "\r" in token:
            raise AuthenticationError("invalid_response")
        if not isfinite(expires_at) or expires_at <= self._clock():
            raise AuthenticationError("expired")
        result = self._request("GET", "/auth/me", token=token)
        user = result.get("user") if result else None
        if (not isinstance(user, dict) or not isinstance(user.get("id"), str) or not user["id"]
                or not isinstance(user.get("email"), str) or not user["email"]
                or user.get("role") not in ("A", "M", "E")
                or type(user.get("mustChangePassword")) is not bool
                or result.get("role") == "Agent" or result.get("deviceId")):
            raise AuthenticationError("invalid_response")
        return VerifiedSession(token, expires_at, user["id"], user["email"], user["role"], user["mustChangePassword"])

    def login(self, email, password):
        result = self._request("POST", "/auth/login", body={"email": email.strip(), "password": password})
        if not result:
            raise AuthenticationError("invalid_response")
        token, seconds = result.get("accessToken"), result.get("expiresIn")
        if (not isinstance(token, str) or not token or type(seconds) not in (int, float)
                or not isfinite(seconds) or seconds <= 0 or result.get("tokenType") != "Bearer"):
            raise AuthenticationError("invalid_response")
        try:
            return self.verify(token, self._clock() + seconds)
        except Exception:
            self.logout(token)
            raise

    def change_password(self, token, current_password, new_password):
        self._request("PUT", "/auth/change-password", token=token,
                      body={"currentPassword": current_password, "newPassword": new_password})

    def logout(self, token):
        if not token:
            return True
        try:
            self._request("POST", "/auth/logout", token=token)
            return True
        except AuthenticationError as error:
            # An invalid/expired token is already unusable server-side.
            return error.code == "invalid_credentials"
