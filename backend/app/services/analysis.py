"""Analysis orchestration and aggregation over matched intervals."""

from __future__ import annotations

from collections import Counter, OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from typing import Literal

from app.config import Settings
from app.domain.cutoff import CutoffPolicy
from app.domain.metrics import MetricSet, compute_metrics
from app.domain.selection import ExclusionReason, IntervalResult, build_intervals
from app.domain.timeutils import expected_interval_starts, london_date
from app.services.dataset_store import DatasetSnapshot
from app.services.ingestion import IngestionService

Granularity = Literal["day", "week"]


@dataclass(frozen=True, slots=True)
class AnalysisParams:
    date_from: date
    date_to: date
    policy: CutoffPolicy

    @property
    def key(self) -> tuple[date, date, tuple[str, str, int, float]]:
        return (self.date_from, self.date_to, self.policy.key)


@dataclass(frozen=True, slots=True)
class AnalysisRun:
    params: AnalysisParams
    intervals: tuple[IntervalResult, ...]
    metrics: MetricSet
    exclusion_counts: dict[str, int]
    snapshot: DatasetSnapshot

    @property
    def matched(self) -> list[IntervalResult]:
        return [i for i in self.intervals if i.included]


@lru_cache(maxsize=64)
def _expected(d_from: date, d_to: date) -> tuple[datetime, ...]:
    return tuple(expected_interval_starts(d_from, d_to))


def summarise(intervals: Sequence[IntervalResult], wape_min: float) -> MetricSet:
    pairs = [
        (i.forecast, i.actual) for i in intervals if i.included and i.forecast is not None and i.actual is not None
    ]
    return compute_metrics(pairs, wape_min)


class AnalysisService:
    def __init__(self, ingestion: IngestionService, settings: Settings) -> None:
        self._ingestion = ingestion
        self._settings = settings
        self._cache: OrderedDict[tuple[object, ...], AnalysisRun] = OrderedDict()

    def run(self, params: AnalysisParams) -> AnalysisRun:
        snap = self._ingestion.snapshot
        key = (snap.version, *params.key)
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit

        starts = _expected(params.date_from, params.date_to)
        intervals = build_intervals(starts, snap.actuals, snap.forecasts, params.policy)
        metrics = summarise(intervals, self._settings.wape_min_mean_actual_mw)
        counts: Counter[str] = Counter()
        for i in intervals:
            for r in i.reasons:
                counts[r.value] += 1
        run = AnalysisRun(params, tuple(intervals), metrics, dict(counts), snap)

        self._cache[key] = run
        while len(self._cache) > 64:
            self._cache.popitem(last=False)
        return run

    # ------------------------------------------------------------ sensitivity
    def cutoff_sensitivity(self, params: AnalysisParams) -> list[SensitivityRow]:
        snap = self._ingestion.snapshot
        starts = _expected(params.date_from, params.date_to)
        selected = params.policy
        candidates: list[CutoffPolicy] = []
        if selected.mode == "day_ahead":
            for hour in range(6, 13):
                candidates.append(CutoffPolicy("day_ahead", time(hour, 0), selected.days_before, selected.lead_hours))
        else:
            for hours in (6, 12, 18, 24, 30, 36, 48):
                candidates.append(CutoffPolicy("lead_time", selected.local_time, selected.days_before, float(hours)))
        if selected.key not in {c.key for c in candidates}:
            candidates.append(selected)
        if selected.mode == "day_ahead":
            candidates.sort(key=lambda c: c.local_time)
        else:
            candidates.sort(key=lambda c: c.lead_hours)

        results = [build_intervals(starts, snap.actuals, snap.forecasts, c) for c in candidates]
        included_sets = [{i.start_time for i in r if i.included} for r in results]
        common = set.intersection(*included_sets) if included_sets else set()
        wape_min = self._settings.wape_min_mean_actual_mw

        rows: list[SensitivityRow] = []
        for policy, intervals in zip(candidates, results, strict=True):
            own = summarise(intervals, wape_min)
            common_metrics = summarise([i for i in intervals if i.start_time in common], wape_min)
            rows.append(
                SensitivityRow(
                    policy=policy,
                    is_selected=policy.key == selected.key,
                    expected=len(starts),
                    own=own,
                    common=common_metrics,
                )
            )
        return rows


@dataclass(frozen=True, slots=True)
class SensitivityRow:
    policy: CutoffPolicy
    is_selected: bool
    expected: int
    own: MetricSet
    common: MetricSet


# --------------------------------------------------------------------- aggregation


@dataclass(frozen=True, slots=True)
class BucketRow:
    bucket_start: date
    bucket_end: date
    n_expected: int
    n_matched: int
    metrics: MetricSet
    partial: bool


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def bucketize(
    intervals: Sequence[IntervalResult],
    granularity: Granularity,
    date_from: date,
    date_to: date,
    wape_min: float,
) -> list[BucketRow]:
    groups: dict[date, list[IntervalResult]] = {}
    for i in intervals:
        d = london_date(i.start_time)
        key = d if granularity == "day" else _monday(d)
        groups.setdefault(key, []).append(i)

    rows: list[BucketRow] = []
    for key in sorted(groups):
        group = groups[key]
        if granularity == "day":
            start = end = key
            partial = False
        else:
            start = max(key, date_from)
            end = min(key + timedelta(days=6), date_to)
            partial = (end - start).days + 1 < 7
        rows.append(
            BucketRow(
                bucket_start=start,
                bucket_end=end,
                n_expected=len(group),
                n_matched=sum(1 for g in group if g.included),
                metrics=summarise(group, wape_min),
                partial=partial,
            )
        )
    return rows


@dataclass(frozen=True, slots=True)
class BiasDirection:
    n: int
    over_count: int
    under_count: int
    exact_count: int
    mean_over_mw: float | None
    mean_under_mw: float | None


def bias_direction(intervals: Sequence[IntervalResult]) -> BiasDirection:
    over = [e for i in intervals if (e := i.signed_error) is not None and e > 0]
    under = [e for i in intervals if (e := i.signed_error) is not None and e < 0]
    exact = sum(1 for i in intervals if i.signed_error == 0)
    return BiasDirection(
        n=len(over) + len(under) + exact,
        over_count=len(over),
        under_count=len(under),
        exact_count=exact,
        mean_over_mw=sum(over) / len(over) if over else None,
        mean_under_mw=sum(under) / len(under) if under else None,
    )


def top_errors(intervals: Sequence[IntervalResult], n: int) -> list[IntervalResult]:
    matched = [i for i in intervals if i.abs_error is not None]
    matched.sort(key=lambda i: (-(i.abs_error or 0.0), i.start_time))
    return matched[:n]


@dataclass(frozen=True, slots=True)
class MissingRun:
    start: datetime
    end: datetime  # exclusive: last interval start + 30 minutes
    count: int
    reasons: tuple[ExclusionReason, ...]


def missing_runs(intervals: Sequence[IntervalResult], limit: int = 25) -> list[MissingRun]:
    runs: list[MissingRun] = []
    current: list[IntervalResult] = []

    def flush() -> None:
        if current:
            runs.append(
                MissingRun(
                    start=current[0].start_time,
                    end=current[-1].start_time + timedelta(minutes=30),
                    count=len(current),
                    reasons=current[0].reasons,
                )
            )
            current.clear()

    for i in intervals:
        if i.included:
            flush()
        elif current and current[-1].reasons != i.reasons:
            flush()
            current.append(i)
        else:
            current.append(i)
    flush()
    runs.sort(key=lambda r: (-r.count, r.start))
    return runs[:limit]
