"""Tolerant parsing of raw Elexon records.

The parsers never raise on bad input: a record that cannot be used is counted in
``ParseIssues`` so the Data Quality page can report it. Missing / null generation is kept
as ``None`` and is never converted to zero.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.domain.timeutils import is_half_hour_aligned, parse_timestamp, settlement_date_and_period

WIND = "WIND"


@dataclass(frozen=True, slots=True)
class ActualRecord:
    start_time: datetime  # UTC
    publish_time: datetime | None  # UTC
    generation: float | None  # MW
    settlement_date: date | None = None
    settlement_period: int | None = None


@dataclass(frozen=True, slots=True)
class ForecastRecord:
    start_time: datetime  # UTC
    publish_time: datetime  # UTC (records without one are unusable and are dropped)
    generation: float | None  # MW


@dataclass(slots=True)
class ParseIssues:
    total_raw: int = 0
    malformed: int = 0  # not an object, or startTime missing/unparseable
    non_wind: int = 0  # fuelType present but not WIND (actuals only)
    missing_fuel_type: int = 0  # fuelType absent (actuals only); cannot be confirmed as WIND
    naive_timestamps: int = 0  # timestamp without offset, assumed UTC
    misaligned_start: int = 0  # startTime not on a :00/:30 boundary
    settlement_mismatch: int = 0  # settlementDate/Period disagree with startTime (actuals)
    missing_publish_time: int = 0
    null_generation: int = 0
    invalid_generation: int = 0  # non-numeric, non-finite or negative
    start_minute_counts: Counter[int] = field(default_factory=Counter)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_raw": self.total_raw,
            "malformed": self.malformed,
            "non_wind": self.non_wind,
            "missing_fuel_type": self.missing_fuel_type,
            "naive_timestamps": self.naive_timestamps,
            "misaligned_start": self.misaligned_start,
            "settlement_mismatch": self.settlement_mismatch,
            "missing_publish_time": self.missing_publish_time,
            "null_generation": self.null_generation,
            "invalid_generation": self.invalid_generation,
            "start_minute_counts": dict(self.start_minute_counts),
        }


def parse_generation(value: object) -> tuple[float | None, str]:
    """Return ``(value_mw_or_None, status)`` where status is ok | null | invalid."""
    if value is None:
        return None, "null"
    if isinstance(value, bool):
        return None, "invalid"
    if isinstance(value, int | float):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None, "invalid"
    else:
        return None, "invalid"
    if not math.isfinite(number) or number < 0:
        return None, "invalid"
    return number, "ok"


def _parse_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _parse_date(value: object) -> date | None:
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None
    return None


def parse_actuals(raw: Iterable[Any]) -> tuple[list[ActualRecord], ParseIssues]:
    """Parse FUELHH records, keeping only fuelType == WIND."""
    issues = ParseIssues()
    out: list[ActualRecord] = []
    for item in raw:
        issues.total_raw += 1
        if not isinstance(item, dict):
            issues.malformed += 1
            continue
        fuel = item.get("fuelType")
        if not isinstance(fuel, str) or not fuel.strip():
            issues.missing_fuel_type += 1
            continue
        if fuel.strip().upper() != WIND:
            issues.non_wind += 1
            continue
        start, naive = parse_timestamp(item.get("startTime"))
        if start is None:
            issues.malformed += 1
            continue
        if naive:
            issues.naive_timestamps += 1
        issues.start_minute_counts[start.minute] += 1
        if not is_half_hour_aligned(start):
            issues.misaligned_start += 1
            continue
        publish, publish_naive = parse_timestamp(item.get("publishTime"))
        if publish is None:
            issues.missing_publish_time += 1
        elif publish_naive:
            issues.naive_timestamps += 1
        generation, status = parse_generation(item.get("generation"))
        if status == "null":
            issues.null_generation += 1
        elif status == "invalid":
            issues.invalid_generation += 1
        s_date = _parse_date(item.get("settlementDate"))
        s_period = _parse_int(item.get("settlementPeriod"))
        if s_date is not None and s_period is not None:
            exp_date, exp_period = settlement_date_and_period(start)
            if (s_date, s_period) != (exp_date, exp_period):
                issues.settlement_mismatch += 1
        out.append(ActualRecord(start, publish, generation, s_date, s_period))
    return out, issues


def parse_forecasts(raw: Iterable[Any]) -> tuple[list[ForecastRecord], ParseIssues]:
    """Parse WINDFOR records. A forecast without a publishTime is dropped: we can never
    prove it was available at the decision cutoff, so we never assume it was."""
    issues = ParseIssues()
    out: list[ForecastRecord] = []
    for item in raw:
        issues.total_raw += 1
        if not isinstance(item, dict):
            issues.malformed += 1
            continue
        start, naive = parse_timestamp(item.get("startTime"))
        if start is None:
            issues.malformed += 1
            continue
        if naive:
            issues.naive_timestamps += 1
        issues.start_minute_counts[start.minute] += 1
        if not is_half_hour_aligned(start):
            issues.misaligned_start += 1
            continue
        publish, publish_naive = parse_timestamp(item.get("publishTime"))
        if publish is None:
            issues.missing_publish_time += 1
            continue
        if publish_naive:
            issues.naive_timestamps += 1
        generation, status = parse_generation(item.get("generation"))
        if status == "null":
            issues.null_generation += 1
        elif status == "invalid":
            issues.invalid_generation += 1
        out.append(ForecastRecord(start, publish, generation))
    return out, issues
