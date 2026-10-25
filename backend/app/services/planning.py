"""Deterministic download plan: which API requests make up the configured period."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from app.config import Settings
from app.domain.timeutils import iso_z, london_midnight_utc

ChunkState = Literal["pending", "cached", "downloaded", "cached_stale", "failed"]


@dataclass(frozen=True, slots=True)
class ChunkSpec:
    dataset: Literal["FUELHH", "WINDFOR"]
    key: str
    params: dict[str, str]
    window: str  # human-readable description of what the request covers


@dataclass(slots=True)
class ChunkStatus:
    dataset: str
    key: str
    window: str
    state: ChunkState = "pending"
    retrieved_at: datetime | None = None
    record_count: int | None = None
    attempts: int = 0
    duration_ms: int | None = None
    error: str | None = None

    @property
    def usable(self) -> bool:
        return self.state in ("cached", "downloaded", "cached_stale")


def publish_window(settings: Settings) -> tuple[datetime, datetime]:
    """UTC window of forecast publications to download for the configured period."""
    start = london_midnight_utc(settings.period_start - timedelta(days=settings.windfor_lookback_days))
    end = london_midnight_utc(settings.period_end + timedelta(days=1))
    return start, end


def delivery_window(settings: Settings) -> tuple[datetime, datetime]:
    """UTC window of delivery intervals (startTime) covered by the period."""
    return (
        london_midnight_utc(settings.period_start),
        london_midnight_utc(settings.period_end + timedelta(days=1)),
    )


def plan_chunks(settings: Settings) -> list[ChunkSpec]:
    specs: list[ChunkSpec] = []

    d: date = settings.period_start
    while d <= settings.period_end:
        end = min(d + timedelta(days=settings.fuelhh_chunk_days - 1), settings.period_end)
        specs.append(
            ChunkSpec(
                dataset="FUELHH",
                key=f"FUELHH_WIND_{d.isoformat()}_{end.isoformat()}",
                params={
                    "settlementDateFrom": d.isoformat(),
                    "settlementDateTo": end.isoformat(),
                    "fuelType": "WIND",
                },
                window=f"settlement dates {d.isoformat()} to {end.isoformat()}",
            )
        )
        d = end + timedelta(days=1)

    pub_start, pub_end = publish_window(settings)
    cur = pub_start
    step = timedelta(hours=settings.windfor_chunk_hours)
    while cur < pub_end:
        nxt = min(cur + step, pub_end)
        specs.append(
            ChunkSpec(
                dataset="WINDFOR",
                key=f"WINDFOR_{iso_z(cur).replace(':', '')}_{iso_z(nxt).replace(':', '')}",
                params={"publishDateTimeFrom": iso_z(cur), "publishDateTimeTo": iso_z(nxt)},
                window=f"published {iso_z(cur)} to {iso_z(nxt)}",
            )
        )
        cur = nxt
    return specs
