"""Analysis endpoints: summary, series, intervals, accuracy, sensitivity, data quality."""

from __future__ import annotations

import math
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app import presenters
from app.deps import ContainerDep, ParamsDep
from app.domain.selection import build_intervals, select_forecast
from app.domain.timeutils import is_half_hour_aligned, parse_timestamp
from app.errors import ApiError
from app.schemas import (
    AccuracyOut,
    IntervalDetailOut,
    IntervalsPageOut,
    QualityOut,
    SensitivityOut,
    SensitivityRowOut,
    SeriesOut,
    SeriesPointOut,
    SummaryOut,
    VintageOut,
)
from app.services.analysis import (
    Granularity,
    bias_direction,
    bucketize,
    missing_runs,
    top_errors,
)
from app.services.intervals_query import (
    Direction,
    IntervalQuery,
    SortKey,
    apply_query,
    iter_csv,
)
from app.services.planning import delivery_window

router = APIRouter(prefix="/api/v1", tags=["analysis"])

SortKeyQ = Literal["start_time", "actual_mw", "forecast_mw", "signed_error_mw", "abs_error_mw", "forecast_publish_time"]


def _period(params_from: date, params_to: date, n: int):  # type: ignore[no-untyped-def]
    return presenters.period_out(params_from, params_to, n)


@router.get("/analysis/summary", response_model=SummaryOut)
def summary(
    container: ContainerDep,
    params: ParamsDep,
    bin_width_mw: Annotated[float | None, Query(gt=0, le=10000)] = None,
) -> SummaryOut:
    s = container.settings
    run = container.analysis.run(params)
    cutoff = presenters.cutoff_out(params.policy, s)
    metrics = presenters.metrics_out(run.metrics, s)
    buckets = bucketize(run.intervals, "day", params.date_from, params.date_to, s.wape_min_mean_actual_mw)
    return SummaryOut(
        period=_period(params.date_from, params.date_to, len(run.intervals)),
        cutoff=cutoff,
        metrics=metrics,
        coverage=presenters.coverage_out(run),
        daily=[presenters.bucket_out(b, s, "day") for b in buckets],
        histogram=presenters.histogram_out(run, bin_width_mw),
        exclusion_counts=run.exclusion_counts,
        data=presenters.freshness_out(container.ingestion),
        warnings=presenters.build_warnings(run, container.ingestion, s, metrics, cutoff),
    )


@router.get("/analysis/series", response_model=SeriesOut)
def series(container: ContainerDep, params: ParamsDep) -> SeriesOut:
    run = container.analysis.run(params)
    return SeriesOut(
        period=_period(params.date_from, params.date_to, len(run.intervals)),
        cutoff=presenters.cutoff_out(params.policy, container.settings),
        points=[
            SeriesPointOut(
                start_time=i.start_time,
                actual_mw=i.actual,
                forecast_mw=i.forecast,
                signed_error_mw=i.signed_error,
                forecast_publish_time=i.forecast_publish_time,
                status="matched" if i.included else "excluded",
                reasons=[r.value for r in i.reasons],
            )
            for i in run.intervals
        ],
        data=presenters.freshness_out(container.ingestion),
    )


def _query(
    q: str, status: str, direction: Direction, sort_by: SortKey, sort_dir: Literal["asc", "desc"]
) -> IntervalQuery:
    valid_status = {
        "all",
        "matched",
        "excluded",
        "missing_actual",
        "invalid_actual",
        "ambiguous_actual",
        "no_forecast_record",
        "forecast_hourly_resolution",
        "forecast_only_after_cutoff",
        "invalid_forecast",
        "ambiguous_forecast",
    }
    if status not in valid_status:
        raise ApiError(422, "invalid_status", f"status must be one of {sorted(valid_status)}")
    return IntervalQuery(q=q.strip(), status=status, direction=direction, sort_by=sort_by, sort_desc=sort_dir == "desc")


@router.get("/analysis/intervals", response_model=IntervalsPageOut)
def intervals_page(
    container: ContainerDep,
    params: ParamsDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
    sort_by: SortKeyQ = "start_time",
    sort_dir: Literal["asc", "desc"] = "asc",
    status: str = "all",
    direction: Direction = "all",
    q: Annotated[str, Query(max_length=100)] = "",
) -> IntervalsPageOut:
    run = container.analysis.run(params)
    filtered = apply_query(run.intervals, _query(q, status, direction, sort_by, sort_dir))
    total = len(filtered)
    total_pages = max(1, math.ceil(total / page_size))
    page = min(page, total_pages)
    window = filtered[(page - 1) * page_size : page * page_size]
    matched = sum(1 for i in filtered if i.included)
    return IntervalsPageOut(
        items=[presenters.interval_out(i) for i in window],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        matched_in_filter=matched,
        excluded_in_filter=total - matched,
        cutoff=presenters.cutoff_out(params.policy, container.settings),
    )


@router.get("/analysis/intervals.csv", response_class=StreamingResponse)
def intervals_csv(
    container: ContainerDep,
    params: ParamsDep,
    sort_by: SortKeyQ = "start_time",
    sort_dir: Literal["asc", "desc"] = "asc",
    status: str = "all",
    direction: Direction = "all",
    q: Annotated[str, Query(max_length=100)] = "",
) -> StreamingResponse:
    """CSV of exactly the rows matching the current filters (all pages)."""
    run = container.analysis.run(params)
    filtered = apply_query(run.intervals, _query(q, status, direction, sort_by, sort_dir))
    name = f"windscope_intervals_{params.date_from}_{params.date_to}.csv"
    return StreamingResponse(
        iter_csv(filtered),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/analysis/intervals/{start_time}", response_model=IntervalDetailOut)
def interval_detail(start_time: str, container: ContainerDep, params: ParamsDep) -> IntervalDetailOut:
    """One interval with every forecast vintage, showing which were usable at the cutoff."""
    start, _ = parse_timestamp(start_time)
    if start is None or not is_half_hour_aligned(start):
        raise ApiError(422, "invalid_start_time", "start_time must be an ISO-8601 half-hour boundary")
    w_start, w_end = delivery_window(container.settings)
    if not (w_start <= start < w_end):
        raise ApiError(404, "interval_not_found", "That interval is outside the analysis period")

    snap = container.ingestion.snapshot
    result = build_intervals([start], snap.actuals, snap.forecasts, params.policy)[0]
    series_ = snap.forecasts.by_start.get(start)
    selection = select_forecast(series_, result.cutoff)
    selected_publish = selection.entry.publish_time if selection.entry else None

    vintages: list[VintageOut] = []
    total = 0
    if series_ is not None:
        total = len(series_.entries)
        for e in reversed(series_.entries):
            vintages.append(
                VintageOut(
                    publish_time=e.publish_time,
                    forecast_mw=e.value,
                    ambiguous=e.ambiguous,
                    published_at_or_before_cutoff=e.publish_time <= result.cutoff,
                    selected=selected_publish is not None and e.publish_time == selected_publish,
                )
            )
    cap = 300
    actual = snap.actuals.by_start.get(start)
    return IntervalDetailOut(
        interval=presenters.interval_out(result),
        vintages=vintages[:cap],
        vintages_total=total,
        truncated=total > cap,
        actual_record_count=actual.record_count if actual else 0,
        actual_publish_time=actual.publish_time if actual else None,
    )


@router.get("/analysis/accuracy", response_model=AccuracyOut)
def accuracy(
    container: ContainerDep,
    params: ParamsDep,
    granularity: Granularity = "day",
    top_n: Annotated[int, Query(ge=1, le=100)] = 10,
) -> AccuracyOut:
    s = container.settings
    run = container.analysis.run(params)
    cutoff = presenters.cutoff_out(params.policy, s)
    metrics = presenters.metrics_out(run.metrics, s)
    buckets = bucketize(run.intervals, granularity, params.date_from, params.date_to, s.wape_min_mean_actual_mw)
    p95 = run.metrics.p95_abs_error
    note = (
        "Largest absolute errors among matched intervals. These are descriptive rankings only; the "
        "data here cannot show why an error occurred."
    )
    if p95 is not None:
        note += f" The 95th-percentile absolute error is {p95:,.0f} MW."
    return AccuracyOut(
        period=_period(params.date_from, params.date_to, len(run.intervals)),
        cutoff=cutoff,
        granularity=granularity,
        metrics=metrics,
        buckets=[presenters.bucket_out(b, s, granularity) for b in buckets],
        bias_direction=presenters.bias_direction_out(bias_direction(run.intervals)),
        high_error_intervals=[presenters.interval_out(i) for i in top_errors(run.intervals, top_n)],
        high_error_note=note,
        warnings=presenters.build_warnings(run, container.ingestion, s, metrics, cutoff),
    )


@router.get("/analysis/cutoff-sensitivity", response_model=SensitivityOut)
def cutoff_sensitivity(container: ContainerDep, params: ParamsDep) -> SensitivityOut:
    s = container.settings
    rows = container.analysis.cutoff_sensitivity(params)
    out: list[SensitivityRowOut] = []
    for r in rows:
        label = f"{r.policy.local_time:%H:%M}" if r.policy.mode == "day_ahead" else f"{r.policy.lead_hours:g} h before"
        out.append(
            SensitivityRowOut(
                label=label,
                cutoff_time=r.policy.local_time.strftime("%H:%M") if r.policy.mode == "day_ahead" else None,
                lead_hours=r.policy.lead_hours if r.policy.mode == "lead_time" else None,
                is_selected=r.is_selected,
                expected_intervals=r.expected,
                matched=r.own.n,
                coverage_ratio=presenters.ratio(r.own.n, r.expected),
                mae_mw=r.own.mae,
                rmse_mw=r.own.rmse,
                bias_mw=r.own.bias,
                common_matched=r.common.n,
                common_mae_mw=r.common.mae,
                common_bias_mw=r.common.bias,
            )
        )
    return SensitivityOut(
        period=_period(params.date_from, params.date_to, rows[0].expected if rows else 0),
        selected_cutoff=presenters.cutoff_out(params.policy, s),
        rows=out,
        note=(
            "Each row re-runs the vintage selection with a different cutoff. 'Own sample' metrics use "
            "the intervals matched under that cutoff, so samples can differ; 'common sample' metrics "
            "use only intervals matched under every cutoff shown, for a like-for-like comparison."
        ),
    )


@router.get("/quality", response_model=QualityOut)
def quality(container: ContainerDep, params: ParamsDep) -> QualityOut:
    s = container.settings
    run = container.analysis.run(params)
    snap = run.snapshot
    cutoff = presenters.cutoff_out(params.policy, s)
    metrics = presenters.metrics_out(run.metrics, s)
    matched = run.metrics.n
    return QualityOut(
        period=_period(params.date_from, params.date_to, len(run.intervals)),
        cutoff=cutoff,
        actual=presenters.actual_quality(run),
        forecast=presenters.forecast_quality(run),
        alignment=presenters.alignment_out(snap),
        exclusion_counts=run.exclusion_counts,
        matched=matched,
        excluded=len(run.intervals) - matched,
        missing_runs=[presenters.missing_run_out(r) for r in missing_runs(run.intervals)],
        sources=presenters.sources_out(snap),
        data=presenters.freshness_out(container.ingestion),
        warnings=presenters.build_warnings(run, container.ingestion, s, metrics, cutoff),
    )
