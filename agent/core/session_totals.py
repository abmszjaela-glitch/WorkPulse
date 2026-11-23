"""In-memory totals across stopped listener runs; paused wall time is excluded."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SessionTotals:
    mouse_movements: int = 0
    mouse_clicks: int = 0
    key_presses: int = 0
    active_seconds: float = 0.0
    idle_seconds: float = 0.0
    app_usage: dict[str, float] = field(default_factory=dict)

    def plus_run(self, summary, durations):
        """Project a run onto completed totals, never add a polled value twice."""
        apps = dict(self.app_usage)
        for name, seconds in summary.app_usage.items():
            apps[name] = apps.get(name, 0.0) + seconds
        return SessionTotals(
            self.mouse_movements + summary.mouse_movements,
            self.mouse_clicks + summary.mouse_clicks,
            self.key_presses + summary.key_presses,
            self.active_seconds + durations["active_seconds"],
            self.idle_seconds + durations["idle_seconds"], apps,
        )

    def as_dict(self):
        return {"mouse_movements": self.mouse_movements, "mouse_clicks": self.mouse_clicks,
                "key_presses": self.key_presses, "active_seconds": self.active_seconds,
                "idle_seconds": self.idle_seconds, "application_usage_seconds": dict(self.app_usage)}
