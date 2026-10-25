"""Map domain objects to the typed API contract, including plain-English explanations."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time

from app import __version__
from app.config import Settings
from app.domain.cutoff import CutoffPolicy
from app.domain.metrics import MetricSet, error_histogram
from app.domain.selection import ExclusionReason, IntervalResult
from app.domain.timeutils import settlement_date_and_period, to_london
from app.schemas import (
    ActualQualityOut,
    AlignmentIssuesOut,
    BiasDirectionOut,
    BucketOut,
    ChunkOut,
    CoverageOut,
    CutoffOut,
    DatasetFreshnessOut,
    DatasetState,
    DatasetStatusOut,
    ForecastQualityOut,
    HistogramBinOut,
    HistogramOut,
    IntervalOut,
    MetricsOut,
    MissingRunOut,
    PeriodOut,
    SourceOut,
    WarningOut,
)
from app.services.analysis import AnalysisRun, BiasDirection, BucketRow, MissingRun
from app.services.dataset_store import DatasetSnapshot
from app.services.ingestion import IngestionService

BUCKET_MIN_N = 12

DATASET_DESCRIPTIONS = {
    "FUELHH": "Elexon FUELHH - half-hourly generation outturn by fuel type (filtered to fuelType = WIND): actual national wind generation, MW.",
    "WINDFOR": "Elexon WINDFOR - wind generation forecasts with a publishTime per forecast vintage, MW.",
}

REASON_TEXT = {
    ExclusionReason.MISSING_ACTUAL: "No FUELHH WIND actual record exists for this half-hour.",
    ExclusionReason.INVALID_ACTUAL: "The FUELHH WIND record has no usable value (null, non-numeric or negative).",
    ExclusionReason.AMBIGUOUS_ACTUAL: "Several FUELHH WIND records share the latest publishTime with different values, so the actual is ambiguous.",
    ExclusionReason.NO_FORECAST_RECORD: "No WINDFOR forecast record exists for this delivery half-hour.",
    ExclusionReason.FORECAST_HOURLY_RESOLUTION: "WINDFOR publishes hourly values only (start times on the hour); there is no forecast for this :30 half-hour. It is not filled in or interpolated.",
    ExclusionReason.INVALID_FORECAST: "The latest forecast published at or before the cutoff has no usable value.",
    ExclusionReason.AMBIGUOUS_FORECAST: "Several WINDFOR records share the selected publishTime with different values, so the forecast is ambiguous.",
}


def default_policy(settings: Settings) -> CutoffPolicy:
    hh, mm = settings.default_cutoff_time.split(":")
    return CutoffPolicy("day_ahead", time(int(hh), int(mm)), settings.default_days_before, settings.default_lead_hours)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC")


def cutoff_out(policy: CutoffPolicy, settings: Settings) -> CutoffOut:
    default = default_policy(settings)
    is_default = policy.key == default.key
    base = f"Decision cutoff: forecasts are only usable if their publishTime is at or before {policy.describe()}."
    if is_default:
        disclosure = (
            base + " ASSUMPTION: the client has not specified an exact purchase-decision cutoff, so this "
            "default (09:00 Europe/London on the day before delivery) is used as a conservative proxy "
            "for a day-ahead process. Confirm the real cutoff with your trading desk."
        )
    else:
        disclosure = base + f" This is a user-selected cutoff; the documented default is {default.describe()}."
    return CutoffOut(
        mode=policy.mode,
        cutoff_time=policy.local_time.strftime("%H:%M") if policy.mode == "day_ahead" else None,
        days_before=policy.days_before if policy.mode == "day_ahead" else None,
        lead_hours=policy.lead_hours if policy.mode == "lead_time" else None,
        description=policy.describe(),
        is_default=is_default,
        disclosure=disclosure,
    )


def period_out(date_from: date, date_to: date, expected: int) -> PeriodOut:
    return PeriodOut(date_from=date_from, date_to=date_to, expected_intervals=expected)


def ratio(num: int, den: int) -> float | None:
    return num / den if den > 0 else None


def metrics_out(m: MetricSet, settings: Settings) -> MetricsOut:
    wape_note: str | None = None
    if m.wape_status == "no_data":
        wape_note = "No matched intervals, so WAPE cannot be computed."
    elif m.wape_status == "denominator_too_small" and m.mean_actual is not None:
        wape_note = (
            f"WAPE not reported: mean actual generation ({m.mean_actual:,.1f} MW) is below the "
            f"{settings.wape_min_mean_actual_mw:,.0f} MW minimum for a meaningful denominator."
        )
    sample_warning: str | None = None
    if m.n == 0:
        sample_warning = "No matched intervals: metrics are unavailable."
    elif m.n < settings.min_sample_warning:
        sample_warning = (
            f"Small sample: only {m.n} matched intervals (fewer than {settings.min_sample_warning}). "
            "Treat these metrics as indicative."
        )
    return MetricsOut(
        n=m.n,
        mae_mw=m.mae,
        rmse_mw=m.rmse,
        bias_mw=m.bias,
        wape=m.wape,
        wape_status=m.wape_status,
        wape_note=wape_note,
        mean_actual_mw=m.mean_actual,
        sum_actual_mw=m.sum_actual,
        median_abs_error_mw=m.median_abs_error,
        p95_abs_error_mw=m.p95_abs_error,
        max_abs_error_mw=m.max_abs_error,
        sample_warning=sample_warning,
    )


def coverage_out(run: AnalysisRun) -> CoverageOut:
    expected = len(run.intervals)
    matched = sum(1 for i in run.intervals if i.included)
    actual_valid = sum(1 for i in run.intervals if i.actual is not None)
    forecast_valid = sum(1 for i in run.intervals if i.forecast is not None)
    return CoverageOut(
        expected_intervals=expected,
        actual_valid=actual_valid,
        forecast_valid_at_cutoff=forecast_valid,
        matched=matched,
        excluded=expected - matched,
        coverage_ratio=ratio(matched, expected),
        actual_coverage_ratio=ratio(actual_valid, expected),
        forecast_coverage_ratio=ratio(forecast_valid, expected),
    )


def bucket_out(row: BucketRow, settings: Settings, granularity: str) -> BucketOut:
    m = row.metrics
    if granularity == "day":
        label = f"{row.bucket_start:%a %d %b}"
    else:
        label = f"{row.bucket_start:%d %b} - {row.bucket_end:%d %b}"
    return BucketOut(
        bucket_start=row.bucket_start,
        bucket_end=row.bucket_end,
        label=label,
        n_expected=row.n_expected,
        n_matched=row.n_matched,
        coverage_ratio=ratio(row.n_matched, row.n_expected),
        mae_mw=m.mae,
        rmse_mw=m.rmse,
        bias_mw=m.bias,
        wape=m.wape,
        wape_status=m.wape_status,
        mean_actual_mw=m.mean_actual,
        partial_bucket=row.partial,
        low_sample=row.n_matched < BUCKET_MIN_N,
    )


def histogram_out(run: AnalysisRun, bin_width: float | None) -> HistogramOut:
    errors = [e for i in run.intervals if (e := i.signed_error) is not None]
    width, bins = error_histogram(errors, bin_width)
    return HistogramOut(
        bin_width_mw=width,
        n=len(errors),
        bins=[HistogramBinOut(lower_mw=b.lower, upper_mw=b.upper, count=b.count) for b in bins],
    )


def bias_direction_out(b: BiasDirection) -> BiasDirectionOut:
    return BiasDirectionOut(
        n=b.n,
        over_count=b.over_count,
        under_count=b.under_count,
        exact_count=b.exact_count,
        over_share=ratio(b.over_count, b.n),
        under_share=ratio(b.under_count, b.n),
        mean_over_mw=b.mean_over_mw,
        mean_under_mw=b.mean_under_mw,
    )


def explain(i: IntervalResult) -> str | None:
    if i.included:
        return None
    parts: list[str] = []
    for r in i.reasons:
        if r == ExclusionReason.FORECAST_ONLY_AFTER_CUTOFF:
            parts.append(
                f"WINDFOR forecasts exist for this half-hour but all were published after the cutoff ({_iso(i.cutoff)}); they were not used."
            )
        else:
            parts.append(REASON_TEXT[r])
    return " ".join(parts)


def interval_out(i: IntervalResult) -> IntervalOut:
    s_date, s_period = settlement_date_and_period(i.start_time)
    return IntervalOut(
        start_time_utc=i.start_time,
        start_time_london=to_london(i.start_time).isoformat(),
        settlement_date=s_date,
        settlement_period=s_period,
        actual_mw=i.actual,
        forecast_mw=i.forecast,
        signed_error_mw=i.signed_error,
        abs_error_mw=i.abs_error,
        forecast_publish_time_utc=i.forecast_publish_time,
        cutoff_utc=i.cutoff,
        status="matched" if i.included else "excluded",
        reasons=[r.value for r in i.reasons],
        explanation=explain(i),
    )


# ------------------------------------------------------------------- dataset state


def dataset_state(ingestion: IngestionService) -> DatasetState:
    if ingestion.state.running:
        return "loading"
    chunks = ingestion.snapshot.chunks
    usable = sum(1 for c in chunks if c.usable)
    total = ingestion.planned_chunks
    if usable == 0:
        return "failed" if ingestion.state.last_error else "empty"
    if usable < total:
        return "partial"
    return "ready"


def freshness_out(ingestion: IngestionService) -> DatasetFreshnessOut:
    snap = ingestion.snapshot
    times = [c.retrieved_at for c in snap.chunks if c.usable and c.retrieved_at]
    return DatasetFreshnessOut(
        state=dataset_state(ingestion),
        stale=ingestion.is_stale(),
        retrieved_at_latest=max(times) if times else None,
        retrieved_at_oldest=min(times) if times else None,
        source_max_publish_time_actual=snap.actual_stats.max_publish_time,
        source_max_publish_time_forecast=snap.forecast_stats.max_publish_time,
    )


def dataset_status_message(state: DatasetState, ingestion: IngestionService, stale: bool) -> str:
    st = ingestion.state
    if state == "loading":
        return f"Downloading from Elexon: {st.completed} of {st.total} requests complete."
    if state == "empty":
        return "No data downloaded yet. Use Retry / Refresh to fetch from the Elexon API."
    if state == "failed":
        return f"Could not retrieve data from Elexon. Last error: {st.last_error}"
    if state == "partial":
        return "Some requests failed. Metrics use only the data that was retrieved; coverage reflects the gaps."
    if stale:
        return "Data is available but older than the freshness threshold or served from a stale cache."
    return "All requests completed."


def dataset_status_out(ingestion: IngestionService, settings: Settings, expected_intervals: int) -> DatasetStatusOut:
    snap = ingestion.snapshot
    fresh = freshness_out(ingestion)
    st = ingestion.state
    return DatasetStatusOut(
        state=fresh.state,
        ingestion_running=st.running,
        stale=fresh.stale,
        stale_after_hours=settings.cache_stale_after_hours,
        chunks_total=ingestion.planned_chunks,
        chunks_usable=sum(1 for c in snap.chunks if c.usable),
        chunks_failed=sum(1 for c in snap.chunks if c.state == "failed"),
        progress_completed=st.completed,
        progress_total=st.total,
        last_attempt_at=st.last_attempt_at,
        last_error=st.last_error,
        retrieved_at_latest=fresh.retrieved_at_latest,
        retrieved_at_oldest=fresh.retrieved_at_oldest,
        source_max_publish_time_actual=fresh.source_max_publish_time_actual,
        source_max_publish_time_forecast=fresh.source_max_publish_time_forecast,
        records_actual=snap.actual_stats.raw_records,
        records_forecast=snap.forecast_stats.raw_records,
        api_base_url=settings.elexon_base_url,
        period=period_out(settings.period_start, settings.period_end, expected_intervals),
        message=dataset_status_message(fresh.state, ingestion, fresh.stale),
    )


# ---------------------------------------------------------------------------- warnings


def build_warnings(
    run: AnalysisRun,
    ingestion: IngestionService,
    settings: Settings,
    metrics: MetricsOut,
    cutoff: CutoffOut,
) -> list[WarningOut]:
    out: list[WarningOut] = []
    state = dataset_state(ingestion)
    if state == "loading":
        out.append(
            WarningOut(
                code="data_loading",
                severity="info",
                message="Data is still downloading; figures will change as requests complete.",
            )
        )
    elif state == "empty":
        out.append(
            WarningOut(
                code="data_empty",
                severity="warning",
                message="No Elexon data has been retrieved yet, so there is nothing to analyse.",
            )
        )
    elif state == "failed":
        out.append(
            WarningOut(
                code="data_failed",
                severity="error",
                message=f"The Elexon source could not be reached. {ingestion.state.last_error or ''}".strip(),
            )
        )
    elif state == "partial":
        failed = sum(1 for c in ingestion.snapshot.chunks if not c.usable)
        out.append(
            WarningOut(
                code="data_partial",
                severity="warning",
                message=f"Partial data: {failed} source request(s) have no data. Coverage figures include these gaps.",
            )
        )
    if ingestion.is_stale() and state in ("ready", "partial"):
        out.append(
            WarningOut(
                code="data_stale",
                severity="warning",
                message="Data is older than the freshness threshold or a refresh failed and cached data is being served.",
            )
        )
    cov = coverage_out(run)
    if cov.expected_intervals and cov.excluded:
        out.append(
            WarningOut(
                code="intervals_excluded",
                severity="warning",
                message=f"{cov.excluded:,} of {cov.expected_intervals:,} expected intervals are excluded from the metrics (see Data Quality).",
            )
        )
    if metrics.sample_warning and state not in ("empty", "failed"):
        out.append(WarningOut(code="small_sample", severity="warning", message=metrics.sample_warning))
    if metrics.wape_note and metrics.wape_status == "denominator_too_small":
        out.append(WarningOut(code="wape_unavailable", severity="info", message=metrics.wape_note))
    if cutoff.is_default:
        out.append(
            WarningOut(
                code="cutoff_assumption",
                severity="info",
                message="The decision cutoff is an assumption (09:00 Europe/London on D-1); the client has not specified it.",
            )
        )
    return out


# -------------------------------------------------------------------------- quality


def _fixed(counter: Counter[int]) -> dict[str, int]:
    return {f":{m:02d}": c for m, c in sorted(counter.items())}


def actual_quality(run: AnalysisRun) -> ActualQualityOut:
    snap = run.snapshot
    expected = len(run.intervals)
    with_record = invalid = ambiguous = valid = 0
    for i in run.intervals:
        res = snap.actuals.by_start.get(i.start_time)
        if res is None:
            continue
        with_record += 1
        if res.ambiguous:
            ambiguous += 1
        elif res.value is None:
            invalid += 1
        else:
            valid += 1
    return ActualQualityOut(
        expected_intervals=expected,
        intervals_with_record=with_record,
        intervals_missing=expected - with_record,
        intervals_valid=valid,
        intervals_invalid_value=invalid,
        intervals_ambiguous=ambiguous,
        duplicate_groups=snap.actuals.duplicate_groups,
        duplicate_records_dropped=snap.actuals.duplicate_records_dropped,
        conflicting_groups=snap.actuals.conflicting_groups,
        coverage_ratio=ratio(valid, expected),
    )


def forecast_quality(run: AnalysisRun) -> ForecastQualityOut:
    snap = run.snapshot
    expected = len(run.intervals)
    counts = Counter(r for i in run.intervals for r in i.reasons)
    any_record = sum(1 for i in run.intervals if i.start_time in snap.forecasts.by_start)
    valid = sum(1 for i in run.intervals if i.forecast is not None)
    minutes = snap.forecast_stats.issues.start_minute_counts
    total_minutes = sum(minutes.values())
    half_hourly = minutes.get(0, 0) + minutes.get(30, 0)
    return ForecastQualityOut(
        expected_intervals=expected,
        intervals_with_any_record=any_record,
        intervals_no_record=counts[ExclusionReason.NO_FORECAST_RECORD],
        intervals_hourly_resolution=counts[ExclusionReason.FORECAST_HOURLY_RESOLUTION],
        intervals_only_after_cutoff=counts[ExclusionReason.FORECAST_ONLY_AFTER_CUTOFF],
        intervals_invalid_value=counts[ExclusionReason.INVALID_FORECAST],
        intervals_ambiguous=counts[ExclusionReason.AMBIGUOUS_FORECAST],
        intervals_valid_at_cutoff=valid,
        duplicate_records_dropped=snap.forecasts.duplicate_records_dropped,
        conflicting_groups=snap.forecasts.conflicting_groups,
        coverage_ratio=ratio(valid, expected),
        half_hourly_start_share=ratio(half_hourly, total_minutes),
        start_minute_counts=_fixed(minutes),
    )


def alignment_out(snap: DatasetSnapshot) -> AlignmentIssuesOut:
    a, f = snap.actual_stats, snap.forecast_stats
    return AlignmentIssuesOut(
        actual_malformed_records=a.issues.malformed,
        actual_non_wind_ignored=a.issues.non_wind,
        actual_missing_fuel_type=a.issues.missing_fuel_type,
        actual_misaligned_start=a.issues.misaligned_start,
        actual_settlement_mismatch=a.issues.settlement_mismatch,
        actual_naive_timestamps=a.issues.naive_timestamps,
        actual_missing_publish_time=a.issues.missing_publish_time,
        actual_outside_period=a.outside_window,
        forecast_malformed_records=f.issues.malformed,
        forecast_misaligned_start=f.issues.misaligned_start,
        forecast_naive_timestamps=f.issues.naive_timestamps,
        forecast_missing_publish_time=f.issues.missing_publish_time,
        forecast_outside_period=f.outside_window,
        overlap_duplicates_actual=a.overlap_duplicates,
        overlap_duplicates_forecast=f.overlap_duplicates,
    )


def missing_run_out(r: MissingRun) -> MissingRunOut:
    return MissingRunOut(
        start_time_utc=r.start,
        end_time_utc=r.end,
        intervals=r.count,
        reasons=[x.value for x in r.reasons],
    )


def sources_out(snap: DatasetSnapshot) -> list[SourceOut]:
    out: list[SourceOut] = []
    for dataset, stats in (("FUELHH", snap.actual_stats), ("WINDFOR", snap.forecast_stats)):
        chunks = [c for c in snap.chunks if c.dataset == dataset]
        ok = [c for c in chunks if c.usable]
        times = [c.retrieved_at for c in ok if c.retrieved_at]
        out.append(
            SourceOut(
                dataset=dataset,
                description=DATASET_DESCRIPTIONS[dataset],
                raw_records=stats.raw_records,
                requests_total=len(chunks),
                requests_ok=len(ok),
                requests_failed=sum(1 for c in chunks if c.state == "failed"),
                latest_retrieval=max(times) if times else None,
                max_source_publish_time=stats.max_publish_time,
                chunks=[
                    ChunkOut(
                        dataset=c.dataset,
                        key=c.key,
                        window=c.window,
                        state=c.state,
                        retrieved_at=c.retrieved_at,
                        record_count=c.record_count,
                        attempts=c.attempts,
                        duration_ms=c.duration_ms,
                        error=c.error,
                    )
                    for c in chunks
                ],
            )
        )
    return out


def version() -> str:
    return __version__
