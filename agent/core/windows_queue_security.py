"""Current-user DPAPI and restricted Windows ACLs for an explicit offline queue."""

from pathlib import Path

import ntsecuritycon
import pywintypes
import win32api
import win32con
import win32crypt
import win32cryptcon
import win32file
import win32security

from .queue_errors import QueueSecurityError


class WindowsQueueSecurity:
    """Never fall back to plaintext or broad permissions when protection fails."""

    def __init__(self) -> None:
        try:
            token = win32security.OpenProcessToken(
                win32api.GetCurrentProcess(), win32con.TOKEN_QUERY
            )
            try:
                self._user = win32security.GetTokenInformation(
                    token, win32security.TokenUser
                )[0]
            finally:
                token.Close()
            self._system = win32security.CreateWellKnownSid(win32security.WinLocalSystemSid)
        except (pywintypes.error, OSError):
            raise QueueSecurityError("Windows queue identity could not be established.") from None

    @staticmethod
    def _reject_reparse_point(path: Path) -> None:
        if win32file.GetFileAttributes(str(path)) & win32con.FILE_ATTRIBUTE_REPARSE_POINT:
            raise QueueSecurityError("Queue paths must not be symbolic links or junctions.")

    def _apply_acl(self, path: Path, *, directory: bool) -> None:
        acl = win32security.ACL()
        flags = (win32con.OBJECT_INHERIT_ACE | win32con.CONTAINER_INHERIT_ACE) if directory else 0
        for sid in (self._user, self._system):
            acl.AddAccessAllowedAceEx(
                win32security.ACL_REVISION_DS, flags, ntsecuritycon.FILE_ALL_ACCESS, sid
            )
        win32security.SetNamedSecurityInfo(
            str(path), win32security.SE_FILE_OBJECT,
            win32security.DACL_SECURITY_INFORMATION | win32security.PROTECTED_DACL_SECURITY_INFORMATION,
            None, None, acl, None,
        )

    def _verify_acl(self, path: Path, *, require_protected: bool) -> None:
        self._reject_reparse_point(path)
        descriptor = win32security.GetNamedSecurityInfo(
            str(path), win32security.SE_FILE_OBJECT, win32security.DACL_SECURITY_INFORMATION
        )
        control, _ = descriptor.GetSecurityDescriptorControl()
        if require_protected and not control & win32security.SE_DACL_PROTECTED:
            raise QueueSecurityError("Existing queue directory must have a protected private ACL.")
        acl = descriptor.GetSecurityDescriptorDacl()
        if acl is None or acl.GetAceCount() == 0:
            raise QueueSecurityError("Queue storage must have an explicit private ACL.")
        expected = {
            win32security.ConvertSidToStringSid(self._user),
            win32security.ConvertSidToStringSid(self._system),
        }
        found = set()
        for index in range(acl.GetAceCount()):
            header, mask, sid = acl.GetAce(index)
            sid_text = win32security.ConvertSidToStringSid(sid)
            if (header[0] != win32security.ACCESS_ALLOWED_ACE_TYPE
                    or sid_text not in expected or mask != ntsecuritycon.FILE_ALL_ACCESS):
                raise QueueSecurityError("Queue storage permissions allow an unexpected identity.")
            found.add(sid_text)
        if found != expected:
            raise QueueSecurityError("Queue storage permissions are incomplete.")

    def prepare(self, database_path: Path) -> None:
        """Secure only the dedicated queue directory and database, never its parents.

        Existing directories must already be private; their permissions are not
        silently rewritten. New parent directories contain no activity data.
        SQLite journals inherit the dedicated directory's private ACL.
        """
        try:
            directory = database_path.parent
            created = False
            try:
                directory.mkdir(parents=True, exist_ok=False)
                created = True
            except FileExistsError:
                if not directory.is_dir():
                    raise QueueSecurityError("Queue directory is unavailable.") from None
            if created:
                self._apply_acl(directory, directory=True)
            self._verify_acl(directory, require_protected=True)
            try:
                with database_path.open("xb"):
                    pass
            except FileExistsError:
                self._verify_acl(database_path, require_protected=False)
            self._apply_acl(database_path, directory=False)
            self._verify_acl(database_path, require_protected=True)
            for suffix in ("-journal", "-wal", "-shm"):
                sidecar = Path(str(database_path) + suffix)
                if sidecar.exists():
                    self._verify_acl(sidecar, require_protected=False)
        except (pywintypes.error, OSError, ValueError):
            raise QueueSecurityError("Private Windows queue storage could not be secured.") from None

    def protect(self, data: bytes) -> bytes:
        try:
            # Current-user scope: intentionally do NOT use LOCAL_MACHINE.
            return win32crypt.CryptProtectData(
                data, "WorkPulse aggregate activity", None, None, None,
                win32cryptcon.CRYPTPROTECT_UI_FORBIDDEN,
            )
        except (pywintypes.error, OSError):
            raise QueueSecurityError("Queue record encryption failed.") from None

    def unprotect(self, data: bytes) -> bytes:
        try:
            _, plaintext = win32crypt.CryptUnprotectData(
                data, None, None, None, win32cryptcon.CRYPTPROTECT_UI_FORBIDDEN
            )
            return plaintext
        except (pywintypes.error, OSError):
            raise QueueSecurityError("Queue record could not be decrypted by this Windows account.") from None
