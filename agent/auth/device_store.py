"""Server/employee-scoped device credentials in Windows Credential Manager only."""
import hashlib
import json
import re
from uuid import UUID
from dataclasses import dataclass, field

import pywintypes
import win32cred
import winerror

from .token_store import TokenStorageError


@dataclass
class DeviceCredentials:
    employee_id: str
    device_id: str
    credential: str = field(repr=False)


class DeviceCredentialStore:
    def __init__(self, server_url, employee_id):
        identity = server_url.rstrip("/") + "|" + employee_id
        self._target = "WorkPulseAgent.Device." + hashlib.sha256(identity.encode()).hexdigest()
        self._employee = employee_id

    def save(self, credentials):
        if credentials.employee_id != self._employee:
            raise TokenStorageError("Device owner does not match this employee.")
        try:
            UUID(credentials.device_id)
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}", credentials.credential):
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise TokenStorageError("Invalid device credential.") from None
        payload = json.dumps({"employee_id": credentials.employee_id, "device_id": credentials.device_id,
                              "credential": credentials.credential}, separators=(",", ":"))
        if len(payload.encode("utf-16-le")) > 2560:
            raise TokenStorageError("Device credential exceeds secure storage capacity.")
        try:
            win32cred.CredWrite({"Type": win32cred.CRED_TYPE_GENERIC, "TargetName": self._target,
                                "UserName": "WorkPulse Agent device", "CredentialBlob": payload,
                                "Persist": win32cred.CRED_PERSIST_LOCAL_MACHINE}, 0)
        except pywintypes.error:
            raise TokenStorageError("Windows could not save the device credential.") from None

    def load(self):
        try:
            item = win32cred.CredRead(self._target, win32cred.CRED_TYPE_GENERIC, 0)
        except pywintypes.error as error:
            if error.winerror == winerror.ERROR_NOT_FOUND:
                return None
            raise TokenStorageError("Windows could not read the device credential.") from None
        try:
            blob = item["CredentialBlob"]
            data = json.loads(blob.decode("utf-16-le") if isinstance(blob, bytes) else blob)
            if set(data) != {"employee_id", "device_id", "credential"} or data["employee_id"] != self._employee:
                raise ValueError
            UUID(data["device_id"])
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}", data["credential"]):
                raise ValueError
            return DeviceCredentials(**data)
        except (ValueError, TypeError, KeyError, UnicodeError):
            raise TokenStorageError("Invalid saved device credential. Ask for a new activation code.") from None
