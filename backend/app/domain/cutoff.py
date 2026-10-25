"""The purchase-decision cutoff policy.

A forecast is only usable for an interval if ``publishTime <= cutoff``. The cutoff is
computed per delivery interval from an explicit, configurable policy:

* ``day_ahead``  - ``local_time`` Europe/London on the day ``days_before`` days before the
  interval's London delivery date (default 09:00 on D-1).
* ``lead_time``  - a fixed number of hours before the interval start.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Literal

from app.domain.timeutils import day_ahead_cutoff, london_date

CutoffMode = Literal["day_ahead", "lead_time"]


@dataclass(frozen=True, slots=True)
class CutoffPolicy:
    mode: CutoffMode = "day_ahead"
    local_time: time = time(9, 0)
    days_before: int = 1
    lead_hours: float = 24.0

    def cutoff_for(self, start_utc: datetime) -> datetime:
        if self.mode == "lead_time":
            return start_utc - timedelta(hours=self.lead_hours)
        return day_ahead_cutoff(london_date(start_utc), self.days_before, self.local_time)

    def describe(self) -> str:
        if self.mode == "lead_time":
            return f"{self.lead_hours:g} h before each interval's start"
        when = (
            "on the delivery day"
            if self.days_before == 0
            else f"{self.days_before} day{'s' if self.days_before != 1 else ''} before delivery day"
        )
        return f"{self.local_time:%H:%M} Europe/London, {when}"

    @property
    def key(self) -> tuple[str, str, int, float]:
        return (self.mode, self.local_time.strftime("%H:%M"), self.days_before, self.lead_hours)
