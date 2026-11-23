"""Validated authorized weekly schedule, preserving timezone/DST behavior."""
from datetime import time
from .working_hours import WorkingHoursPolicy


class RemoteWorkingHours:
    def __init__(self, value):
        if not isinstance(value, dict) or value.get("configured") is False:
            raise ValueError("Working-hours policy is unavailable.")
        zone = value.get("timezone")
        schedule = value.get("schedule")
        if schedule is None:
            # Existing environment-based API policy uses ISO weekdays.
            schedule = [{"enabled": day + 1 in value["days"], "start": value["start"], "end": value["end"]} for day in range(7)]
        if len(schedule) != 7 or value.get("configured") is False:
            raise ValueError("Ask your administrator to configure working hours.")
        self._shifts = []
        for day, row in enumerate(schedule):
            if type(row.get("enabled")) is not bool:
                raise ValueError("Invalid working-hours policy.")
            if row["enabled"]:
                self._shifts.append(WorkingHoursPolicy(zone=zone, start=time.fromisoformat(row["start"]),
                                                      end=time.fromisoformat(row["end"]), days={day}))

    def allows(self, now=None):
        return any(shift.allows(now) for shift in self._shifts)

    def describe(self):
        return "; ".join(shift.describe() for shift in self._shifts) or "No working days enabled"

    def next_start(self, now=None):
        openings = [shift.next_start(now) for shift in self._shifts]
        return min((value for value in openings if value is not None), default=None)
