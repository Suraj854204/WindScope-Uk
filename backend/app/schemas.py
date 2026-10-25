"""Typed request/response contract (served as OpenAPI at /openapi.json).

Conventions: snake_case JSON; instants are ISO-8601 UTC strings ending in ``Z``; generation and
errors are in megawatts (MW); ratios (coverage, WAPE) are fractions in [0, 1+], not percentages.
``null`` always means "not available" - never zero.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["info", "warning", "error"]
WapeStatusT = Literal["ok", "no_data", "denominator_too_small"]
DatasetState = Literal["empty", "loading", "ready", "partial", "failed"]
ChunkStateT = Literal["pending", "cached", "downloaded", "cached_stale", "failed"]


class WarningOut(BaseModel):
    code: str
    severity: Severity
    message: str


class CutoffOut(BaseModel):
    mode: Literal["day_ahead", "lead_time"]
    cutoff_time: str | None = Field(None, description="HH:MM Europe/London (day_ahead mode)")
    days_before: int | None = None
    lead_hours: float | None = None
    timezone: str = "Europe/London"
    description: str
    is_default: bool
    disclosure: str


class PeriodOut(BaseModel):
    date_from: date
    date_to: date
    timezone: str = "Europe/London"
    expected_intervals: int


class MetricsOut(BaseModel):
    n: int = Field(description="Matched intervals used for the metrics")
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None = Field(description="Mean of (forecast - actual); >0 = over-forecast")
    wape: float | None = Field(description="Sum|error| / Sum(actual); null when denominator invalid")
    wape_status: WapeStatusT
    wape_note: str | None
    mean_actual_mw: float | None
    sum_actual_mw: float | None
    median_abs_error_mw: float | None
    p95_abs_error_mw: float | None
    max_abs_error_mw: float | None
    sample_warning: str | None


class CoverageOut(BaseModel):
    expected_intervals: int
    actual_valid: int
    forecast_valid_at_cutoff: int
    matched: int
    excluded: int
    coverage_ratio: float | None
    actual_coverage_ratio: float | None
    forecast_coverage_ratio: float | None


class BucketOut(BaseModel):
    bucket_start: date
    bucket_end: date
    label: str
    n_expected: int
    n_matched: int
    coverage_ratio: float | None
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None
    wape: float | None
    wape_status: WapeStatusT
    mean_actual_mw: float | None
    partial_bucket: bool
    low_sample: bool


class HistogramBinOut(BaseModel):
    lower_mw: float
    upper_mw: float
    count: int


class HistogramOut(BaseModel):
    bin_width_mw: float
    n: int
    bins: list[HistogramBinOut]


class DatasetFreshnessOut(BaseModel):
    state: DatasetState
    stale: bool
    retrieved_at_latest: datetime | None
    retrieved_at_oldest: datetime | None
    source_max_publish_time_actual: datetime | None
    source_max_publish_time_forecast: datetime | None


class SummaryOut(BaseModel):
    period: PeriodOut
    cutoff: CutoffOut
    metrics: MetricsOut
    coverage: CoverageOut
    daily: list[BucketOut]
    histogram: HistogramOut
    exclusion_counts: dict[str, int]
    data: DatasetFreshnessOut
    warnings: list[WarningOut]


class SeriesPointOut(BaseModel):
    start_time: datetime
    actual_mw: float | None
    forecast_mw: float | None
    signed_error_mw: float | None
    forecast_publish_time: datetime | None
    status: Literal["matched", "excluded"]
    reasons: list[str]


class SeriesOut(BaseModel):
    period: PeriodOut
    cutoff: CutoffOut
    points: list[SeriesPointOut]
    data: DatasetFreshnessOut


class IntervalOut(BaseModel):
    start_time_utc: datetime
    start_time_london: str
    settlement_date: date
    settlement_period: int
    actual_mw: float | None
    forecast_mw: float | None
    signed_error_mw: float | None
    abs_error_mw: float | None
    forecast_publish_time_utc: datetime | None
    cutoff_utc: datetime
    status: Literal["matched", "excluded"]
    reasons: list[str]
    explanation: str | None = Field(None, description="Plain-English reason for exclusion")


class IntervalsPageOut(BaseModel):
    items: list[IntervalOut]
    total: int
    page: int
    page_size: int
    total_pages: int
    matched_in_filter: int
    excluded_in_filter: int
    cutoff: CutoffOut


class VintageOut(BaseModel):
    publish_time: datetime
    forecast_mw: float | None
    ambiguous: bool
    published_at_or_before_cutoff: bool
    selected: bool


class IntervalDetailOut(BaseModel):
    interval: IntervalOut
    vintages: list[VintageOut]
    vintages_total: int
    truncated: bool
    actual_record_count: int
    actual_publish_time: datetime | None


class BiasDirectionOut(BaseModel):
    n: int
    over_count: int
    under_count: int
    exact_count: int
    over_share: float | None
    under_share: float | None
    mean_over_mw: float | None
    mean_under_mw: float | None


class AccuracyOut(BaseModel):
    period: PeriodOut
    cutoff: CutoffOut
    granularity: Literal["day", "week"]
    metrics: MetricsOut
    buckets: list[BucketOut]
    bias_direction: BiasDirectionOut
    high_error_intervals: list[IntervalOut]
    high_error_note: str
    warnings: list[WarningOut]


class SensitivityRowOut(BaseModel):
    label: str
    cutoff_time: str | None
    lead_hours: float | None
    is_selected: bool
    expected_intervals: int
    matched: int
    coverage_ratio: float | None
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None
    common_matched: int
    common_mae_mw: float | None
    common_bias_mw: float | None


class SensitivityOut(BaseModel):
    period: PeriodOut
    selected_cutoff: CutoffOut
    rows: list[SensitivityRowOut]
    note: str


# ----------------------------------------------------------------------- data quality


class ActualQualityOut(BaseModel):
    expected_intervals: int
    intervals_with_record: int
    intervals_missing: int
    intervals_valid: int
    intervals_invalid_value: int
    intervals_ambiguous: int
    duplicate_groups: int
    duplicate_records_dropped: int
    conflicting_groups: int
    coverage_ratio: float | None


class ForecastQualityOut(BaseModel):
    expected_intervals: int
    intervals_with_any_record: int
    intervals_no_record: int
    intervals_hourly_resolution: int
    intervals_only_after_cutoff: int
    intervals_invalid_value: int
    intervals_ambiguous: int
    intervals_valid_at_cutoff: int
    duplicate_records_dropped: int
    conflicting_groups: int
    coverage_ratio: float | None
    half_hourly_start_share: float | None = Field(
        description="Share of parsed WINDFOR records whose startTime minute is :00 or :30"
    )
    start_minute_counts: dict[str, int]


class AlignmentIssuesOut(BaseModel):
    actual_malformed_records: int
    actual_non_wind_ignored: int
    actual_missing_fuel_type: int
    actual_misaligned_start: int
    actual_settlement_mismatch: int
    actual_naive_timestamps: int
    actual_missing_publish_time: int
    actual_outside_period: int
    forecast_malformed_records: int
    forecast_misaligned_start: int
    forecast_naive_timestamps: int
    forecast_missing_publish_time: int
    forecast_outside_period: int
    overlap_duplicates_actual: int
    overlap_duplicates_forecast: int


class MissingRunOut(BaseModel):
    start_time_utc: datetime
    end_time_utc: datetime
    intervals: int
    reasons: list[str]


class ChunkOut(BaseModel):
    dataset: str
    key: str
    window: str
    state: ChunkStateT
    retrieved_at: datetime | None
    record_count: int | None
    attempts: int
    duration_ms: int | None
    error: str | None


class SourceOut(BaseModel):
    dataset: str
    description: str
    raw_records: int
    requests_total: int
    requests_ok: int
    requests_failed: int
    latest_retrieval: datetime | None
    max_source_publish_time: datetime | None
    chunks: list[ChunkOut]


class QualityOut(BaseModel):
    period: PeriodOut
    cutoff: CutoffOut
    actual: ActualQualityOut
    forecast: ForecastQualityOut
    alignment: AlignmentIssuesOut
    exclusion_counts: dict[str, int]
    matched: int
    excluded: int
    missing_runs: list[MissingRunOut]
    sources: list[SourceOut]
    data: DatasetFreshnessOut
    warnings: list[WarningOut]


# --------------------------------------------------------------------------- dataset


class DatasetStatusOut(BaseModel):
    state: DatasetState
    ingestion_running: bool
    stale: bool
    stale_after_hours: int
    chunks_total: int
    chunks_usable: int
    chunks_failed: int
    progress_completed: int
    progress_total: int
    last_attempt_at: datetime | None
    last_error: str | None
    retrieved_at_latest: datetime | None
    retrieved_at_oldest: datetime | None
    source_max_publish_time_actual: datetime | None
    source_max_publish_time_forecast: datetime | None
    records_actual: int
    records_forecast: int
    api_base_url: str
    period: PeriodOut
    message: str


class RefreshRequest(BaseModel):
    force: bool = Field(False, description="Re-download every request even if cached")


class RefreshOut(BaseModel):
    accepted: bool
    message: str
    status: DatasetStatusOut


class ConfigOut(BaseModel):
    version: str
    environment: str
    period: PeriodOut
    default_cutoff: CutoffOut
    wape_min_mean_actual_mw: float
    min_sample_warning: int
    cache_stale_after_hours: int
    api_base_url: str
    datasets: dict[str, str]


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str
    time: datetime
