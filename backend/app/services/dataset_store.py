"""Immutable in-memory snapshot of the downloaded data, rebuilt after each ingestion."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.domain.parsing import (
    ActualRecord,
    ForecastRecord,
    ParseIssues,
    parse_actuals,
    parse_forecasts,
)
from app.domain.selection import ActualIndex, ForecastIndex, build_actual_index, build_forecast_index
from app.services.planning import ChunkSpec, ChunkStatus


@dataclass(frozen=True, slots=True)
class ChunkPayload:
    spec: ChunkSpec
    records: list[Any]
    retrieved_at: datetime


@dataclass(frozen=True, slots=True)
class SourceStats:
    raw_records: int = 0
    overlap_duplicates: int = 0  # identical records returned by two overlapping requests
    outside_window: int = 0  # parsed records whose startTime lies outside the analysis period
    issues: ParseIssues = field(default_factory=ParseIssues)
    max_publish_time: datetime | None = None  # latest *source* publishTime seen (a data fact)


@dataclass(frozen=True, slots=True)
class DatasetSnapshot:
    actuals: ActualIndex
    forecasts: ForecastIndex
    actual_stats: SourceStats
    forecast_stats: SourceStats
    chunks: tuple[ChunkStatus, ...]
    version: str
    built_at: datetime

    @property
    def has_data(self) -> bool:
        return bool(self.actuals.by_start) or bool(self.forecasts.by_start)


def empty_snapshot(chunks: Sequence[ChunkStatus] = ()) -> DatasetSnapshot:
    return DatasetSnapshot(
        actuals=ActualIndex(),
        forecasts=ForecastIndex(),
        actual_stats=SourceStats(),
        forecast_stats=SourceStats(),
        chunks=tuple(chunks),
        version="empty",
        built_at=datetime.now(UTC),
    )


def _scalar(v: Any) -> Any:
    return v if isinstance(v, str | int | float | type(None)) else repr(v)


def _fingerprint(item: Any) -> Any:
    if not isinstance(item, dict):
        return repr(item)
    return (
        _scalar(item.get("startTime")),
        _scalar(item.get("publishTime")),
        _scalar(item.get("fuelType")),
        _scalar(item.get("generation")),
        _scalar(item.get("settlementDate")),
        _scalar(item.get("settlementPeriod")),
    )


def _merge(payloads: Sequence[ChunkPayload]) -> tuple[list[Any], int]:
    """Concatenate chunk records, dropping records that appear in more than one *chunk*
    (inclusive window boundaries). Duplicates inside one chunk are kept: they are real source
    duplicates and are handled by the deduplication rules."""
    seen: dict[Any, str] = {}
    merged: list[Any] = []
    overlap = 0
    for payload in sorted(payloads, key=lambda p: p.spec.key):
        for item in payload.records:
            fp = _fingerprint(item)
            first = seen.setdefault(fp, payload.spec.key)
            if first != payload.spec.key:
                overlap += 1
                continue
            merged.append(item)
    return merged, overlap


def _max_publish(records: Sequence[ActualRecord] | Sequence[ForecastRecord]) -> datetime | None:
    best: datetime | None = None
    for r in records:
        p = r.publish_time
        if p is not None and (best is None or p > best):
            best = p
    return best


def build_snapshot(
    payloads: Sequence[ChunkPayload],
    chunks: Sequence[ChunkStatus],
    window_start: datetime,
    window_end: datetime,
) -> DatasetSnapshot:
    fuelhh = [p for p in payloads if p.spec.dataset == "FUELHH"]
    windfor = [p for p in payloads if p.spec.dataset == "WINDFOR"]

    raw_a, overlap_a = _merge(fuelhh)
    actual_records, issues_a = parse_actuals(raw_a)
    in_a = [r for r in actual_records if window_start <= r.start_time < window_end]

    raw_f, overlap_f = _merge(windfor)
    forecast_records, issues_f = parse_forecasts(raw_f)
    in_f = [r for r in forecast_records if window_start <= r.start_time < window_end]

    digest = hashlib.sha1(
        "|".join(
            f"{p.spec.key}:{p.retrieved_at.isoformat()}:{len(p.records)}"
            for p in sorted(payloads, key=lambda x: x.spec.key)
        ).encode()
    ).hexdigest()[:16]

    return DatasetSnapshot(
        actuals=build_actual_index(in_a),
        forecasts=build_forecast_index(in_f),
        actual_stats=SourceStats(
            raw_records=issues_a.total_raw + overlap_a,
            overlap_duplicates=overlap_a,
            outside_window=len(actual_records) - len(in_a),
            issues=issues_a,
            max_publish_time=_max_publish(actual_records),
        ),
        forecast_stats=SourceStats(
            raw_records=issues_f.total_raw + overlap_f,
            overlap_duplicates=overlap_f,
            outside_window=len(forecast_records) - len(in_f),
            issues=issues_f,
            max_publish_time=_max_publish(forecast_records),
        ),
        chunks=tuple(chunks),
        version=digest,
        built_at=datetime.now(UTC),
    )
