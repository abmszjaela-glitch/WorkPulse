"""Pure timezone-aware working-hours policy; no input collection or networking."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

if __package__ == "core":
    from config import config
else:
    from ..config import config


class WorkingHoursPolicy:
    """Half-open local wall-clock shifts; overnight shifts belong to start day.

    Both occurrences of a repeated DST hour follow the same wall-clock policy.
    Nonexistent local times simply never occur: decisions convert real UTC
    instants, never attach an offset to a nonexistent scheduled datetime.
    """
    def __init__(self, *, zone=None, start=None, end=None, days=None):
        self.zone = ZoneInfo(config.WORKING_TIMEZONE if zone is None else zone)
        self.start = config.WORKING_START if start is None else start
        self.end = config.WORKING_END if end is None else end
        self.days = config.WORKING_DAYS if days is None else frozenset(days)
        if self.start == self.end or not self.days or not self.days <= set(range(7)):
            raise ValueError("Invalid working-hours policy.")

    def allows(self, now=None):
        now = datetime.now(timezone.utc) if now is None else now
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("Policy decisions require an aware datetime.")
        local = now.astimezone(self.zone)
        clock = local.time().replace(tzinfo=None)
        if self.start < self.end:
            return local.weekday() in self.days and self.start <= clock < self.end
        if clock >= self.start:
            return local.weekday() in self.days
        return clock < self.end and (local - timedelta(days=1)).weekday() in self.days

    def describe(self):
        days = ", ".join(("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[d] for d in sorted(self.days))
        return f"{days} {self.start:%H:%M}–{self.end:%H:%M} ({self.zone.key})"
