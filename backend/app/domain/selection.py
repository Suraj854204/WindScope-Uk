"""Deduplication, forecast-vintage selection and actual/forecast matching.

Rules (also documented on the Methodology page):

Actuals (FUELHH, WIND) - grouped by startTime:
  1. The record with the latest publishTime wins (a missing publishTime ranks lowest).
  2. If several records tie for the latest publishTime with *different* values the interval is
     ``ambiguous_actual`` and excluded - we do not guess.
  3. A winning record whose value is null / invalid is ``invalid_actual`` (never zero).

Forecasts (WINDFOR) - grouped by (startTime, publishTime):
  1. Identical duplicates collapse to one record.
  2. Conflicting duplicates make that vintage ``ambiguous``.
  For each interval we pick the LATEST vintage with publishTime <= cutoff (inclusive). If that
  vintage has no usable value the interval is excluded; we do NOT fall back to an older
  vintage, because the rule is "latest forecast available at decision time".
  Forecasts published after the cutoff are never used.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

from app.domain.cutoff import CutoffPolicy
from app.domain.parsing import ActualRecord, ForecastRecord


class ExclusionReason(StrEnum):
    MISSING_ACTUAL = "missing_actual"
    INVALID_ACTUAL = "invalid_actual"
    AMBIGUOUS_ACTUAL = "ambiguous_actual"
    NO_FORECAST_RECORD = "no_forecast_record"
    FORECAST_HOURLY_RESOLUTION = "forecast_hourly_resolution"
    FORECAST_ONLY_AFTER_CUTOFF = "forecast_only_after_cutoff"
    INVALID_FORECAST = "invalid_forecast"
    AMBIGUOUS_FORECAST = "ambiguous_forecast"


# ----------------------------------------------------------------------------- actuals


@dataclass(frozen=True, slots=True)
class ActualResolution:
    start_time: datetime
    value: float | None
    publish_time: datetime | None
    ambiguous: bool
    record_count: int


@dataclass(slots=True)
class ActualIndex:
    by_start: dict[datetime, ActualResolution] = field(default_factory=dict)
    duplicate_groups: int = 0
    duplicate_records_dropped: int = 0
    conflicting_groups: int = 0


_MIN_DT = datetime.min.replace(tzinfo=UTC)


def build_actual_index(records: Sequence[ActualRecord]) -> ActualIndex:
    groups: dict[datetime, list[ActualRecord]] = {}
    for rec in records:
        groups.setdefault(rec.start_time, []).append(rec)

    index = ActualIndex()
    for start, group in groups.items():
        if len(group) > 1:
            index.duplicate_groups += 1
            index.duplicate_records_dropped += len(group) - 1
        top_publish = max((r.publish_time or _MIN_DT) for r in group)
        top = [r for r in group if (r.publish_time or _MIN_DT) == top_publish]
        values = {r.generation for r in top}
        ambiguous = len(values) > 1
        if ambiguous:
            index.conflicting_groups += 1
        index.by_start[start] = ActualResolution(
            start_time=start,
            value=None if ambiguous else top[0].generation,
            publish_time=top[0].publish_time,
            ambiguous=ambiguous,
            record_count=len(group),
        )
    return index


# --------------------------------------------------------------------------- forecasts


@dataclass(frozen=True, slots=True)
class ForecastEntry:
    publish_time: datetime
    value: float | None
    ambiguous: bool


@dataclass(slots=True)
class ForecastSeries:
    publish_times: list[datetime] = field(default_factory=list)
    entries: list[ForecastEntry] = field(default_factory=list)


@dataclass(slots=True)
class ForecastIndex:
    by_start: dict[datetime, ForecastSeries] = field(default_factory=dict)
    duplicate_records_dropped: int = 0
    conflicting_groups: int = 0
    # True when every forecast startTime is on the hour (WINDFOR is an hourly product), so the
    # :30 half-hours of the FUELHH grid can never have a forecast record of their own.
    hourly_resolution: bool = False


def build_forecast_index(records: Sequence[ForecastRecord]) -> ForecastIndex:
    grouped: dict[datetime, dict[datetime, list[float | None]]] = {}
    for rec in records:
        grouped.setdefault(rec.start_time, {}).setdefault(rec.publish_time, []).append(rec.generation)

    index = ForecastIndex()
    for start, by_pub in grouped.items():
        series = ForecastSeries()
        for publish in sorted(by_pub):
            values = by_pub[publish]
            if len(values) > 1:
                index.duplicate_records_dropped += len(values) - 1
            distinct = set(values)
            ambiguous = len(distinct) > 1
            if ambiguous:
                index.conflicting_groups += 1
            series.publish_times.append(publish)
            series.entries.append(ForecastEntry(publish, None if ambiguous else values[0], ambiguous))
        index.by_start[start] = series
    index.hourly_resolution = bool(index.by_start) and all(s.minute == 0 for s in index.by_start)
    return index


@dataclass(frozen=True, slots=True)
class ForecastSelection:
    entry: ForecastEntry | None
    reason: ExclusionReason | None


def select_forecast(series: ForecastSeries | None, cutoff: datetime) -> ForecastSelection:
    """Latest vintage with publishTime <= cutoff. Never looks past the cutoff."""
    if series is None or not series.entries:
        return ForecastSelection(None, ExclusionReason.NO_FORECAST_RECORD)
    idx = bisect_right(series.publish_times, cutoff)  # first index with publish > cutoff
    if idx == 0:
        return ForecastSelection(None, ExclusionReason.FORECAST_ONLY_AFTER_CUTOFF)
    entry = series.entries[idx - 1]
    if entry.ambiguous:
        return ForecastSelection(entry, ExclusionReason.AMBIGUOUS_FORECAST)
    if entry.value is None:
        return ForecastSelection(entry, ExclusionReason.INVALID_FORECAST)
    return ForecastSelection(entry, None)


# ---------------------------------------------------------------------------- matching


@dataclass(frozen=True, slots=True)
class IntervalResult:
    start_time: datetime
    cutoff: datetime
    actual: float | None
    forecast: float | None
    forecast_publish_time: datetime | None
    reasons: tuple[ExclusionReason, ...]

    @property
    def included(self) -> bool:
        return not self.reasons

    @property
    def signed_error(self) -> float | None:
        if self.actual is None or self.forecast is None or self.reasons:
            return None
        return self.forecast - self.actual

    @property
    def abs_error(self) -> float | None:
        err = self.signed_error
        return None if err is None else abs(err)


def build_intervals(
    starts: Sequence[datetime],
    actuals: ActualIndex,
    forecasts: ForecastIndex,
    policy: CutoffPolicy,
) -> list[IntervalResult]:
    """Match actuals and cutoff-eligible forecasts on the expected UTC half-hour grid."""
    results: list[IntervalResult] = []
    for start in starts:
        cutoff = policy.cutoff_for(start)
        reasons: list[ExclusionReason] = []

        actual_value: float | None = None
        resolution = actuals.by_start.get(start)
        if resolution is None:
            reasons.append(ExclusionReason.MISSING_ACTUAL)
        elif resolution.ambiguous:
            reasons.append(ExclusionReason.AMBIGUOUS_ACTUAL)
        elif resolution.value is None:
            reasons.append(ExclusionReason.INVALID_ACTUAL)
        else:
            actual_value = resolution.value

        series = forecasts.by_start.get(start)
        if series is None and forecasts.hourly_resolution and start.minute != 0:
            # Not a data gap: the forecast product has no half-hourly values. Never filled in or interpolated.
            selection = ForecastSelection(None, ExclusionReason.FORECAST_HOURLY_RESOLUTION)
        else:
            selection = select_forecast(series, cutoff)
        if selection.reason is not None:
            reasons.append(selection.reason)

        entry = selection.entry
        results.append(
            IntervalResult(
                start_time=start,
                cutoff=cutoff,
                actual=actual_value,
                forecast=entry.value if entry is not None and selection.reason is None else None,
                forecast_publish_time=entry.publish_time if entry is not None else None,
                reasons=tuple(reasons),
            )
        )
    return results
