// Mirrors backend/app/schemas.py (see docs/openapi.json). `null` always means "not available" - never zero.

export type Severity = 'info' | 'warning' | 'error'
export type WapeStatus = 'ok' | 'no_data' | 'denominator_too_small'
export type DatasetState = 'empty' | 'loading' | 'ready' | 'partial' | 'failed'
export type ChunkState = 'pending' | 'cached' | 'downloaded' | 'cached_stale' | 'failed'
export type CutoffMode = 'day_ahead' | 'lead_time'
export type ExclusionReason =
  | 'missing_actual'
  | 'invalid_actual'
  | 'ambiguous_actual'
  | 'no_forecast_record'
  | 'forecast_hourly_resolution'
  | 'forecast_only_after_cutoff'
  | 'invalid_forecast'
  | 'ambiguous_forecast'

export interface Warning {
  code: string
  severity: Severity
  message: string
}

export interface Cutoff {
  mode: CutoffMode
  cutoff_time: string | null
  days_before: number | null
  lead_hours: number | null
  timezone: string
  description: string
  is_default: boolean
  disclosure: string
}

export interface Period {
  date_from: string
  date_to: string
  timezone: string
  expected_intervals: number
}

export interface Metrics {
  n: number
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  wape: number | null
  wape_status: WapeStatus
  wape_note: string | null
  mean_actual_mw: number | null
  sum_actual_mw: number | null
  median_abs_error_mw: number | null
  p95_abs_error_mw: number | null
  max_abs_error_mw: number | null
  sample_warning: string | null
}

export interface Coverage {
  expected_intervals: number
  actual_valid: number
  forecast_valid_at_cutoff: number
  matched: number
  excluded: number
  coverage_ratio: number | null
  actual_coverage_ratio: number | null
  forecast_coverage_ratio: number | null
}

export interface Bucket {
  bucket_start: string
  bucket_end: string
  label: string
  n_expected: number
  n_matched: number
  coverage_ratio: number | null
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  wape: number | null
  wape_status: WapeStatus
  mean_actual_mw: number | null
  partial_bucket: boolean
  low_sample: boolean
}

export interface HistogramBin {
  lower_mw: number
  upper_mw: number
  count: number
}

export interface Histogram {
  bin_width_mw: number
  n: number
  bins: HistogramBin[]
}

export interface Freshness {
  state: DatasetState
  stale: boolean
  retrieved_at_latest: string | null
  retrieved_at_oldest: string | null
  source_max_publish_time_actual: string | null
  source_max_publish_time_forecast: string | null
}

export interface Summary {
  period: Period
  cutoff: Cutoff
  metrics: Metrics
  coverage: Coverage
  daily: Bucket[]
  histogram: Histogram
  exclusion_counts: Partial<Record<ExclusionReason, number>>
  data: Freshness
  warnings: Warning[]
}

export interface SeriesPoint {
  start_time: string
  actual_mw: number | null
  forecast_mw: number | null
  signed_error_mw: number | null
  forecast_publish_time: string | null
  status: 'matched' | 'excluded'
  reasons: ExclusionReason[]
}

export interface Series {
  period: Period
  cutoff: Cutoff
  points: SeriesPoint[]
  data: Freshness
}

export interface Interval {
  start_time_utc: string
  start_time_london: string
  settlement_date: string
  settlement_period: number
  actual_mw: number | null
  forecast_mw: number | null
  signed_error_mw: number | null
  abs_error_mw: number | null
  forecast_publish_time_utc: string | null
  cutoff_utc: string
  status: 'matched' | 'excluded'
  reasons: ExclusionReason[]
  explanation: string | null
}

export interface IntervalsPage {
  items: Interval[]
  total: number
  page: number
  page_size: number
  total_pages: number
  matched_in_filter: number
  excluded_in_filter: number
  cutoff: Cutoff
}

export interface Vintage {
  publish_time: string
  forecast_mw: number | null
  ambiguous: boolean
  published_at_or_before_cutoff: boolean
  selected: boolean
}

export interface IntervalDetail {
  interval: Interval
  vintages: Vintage[]
  vintages_total: number
  truncated: boolean
  actual_record_count: number
  actual_publish_time: string | null
}

export interface BiasDirection {
  n: number
  over_count: number
  under_count: number
  exact_count: number
  over_share: number | null
  under_share: number | null
  mean_over_mw: number | null
  mean_under_mw: number | null
}

export interface Accuracy {
  period: Period
  cutoff: Cutoff
  granularity: 'day' | 'week'
  metrics: Metrics
  buckets: Bucket[]
  bias_direction: BiasDirection
  high_error_intervals: Interval[]
  high_error_note: string
  warnings: Warning[]
}

export interface SensitivityRow {
  label: string
  cutoff_time: string | null
  lead_hours: number | null
  is_selected: boolean
  expected_intervals: number
  matched: number
  coverage_ratio: number | null
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  common_matched: number
  common_mae_mw: number | null
  common_bias_mw: number | null
}

export interface Sensitivity {
  period: Period
  selected_cutoff: Cutoff
  rows: SensitivityRow[]
  note: string
}

export interface ActualQuality {
  expected_intervals: number
  intervals_with_record: number
  intervals_missing: number
  intervals_valid: number
  intervals_invalid_value: number
  intervals_ambiguous: number
  duplicate_groups: number
  duplicate_records_dropped: number
  conflicting_groups: number
  coverage_ratio: number | null
}

export interface ForecastQuality {
  expected_intervals: number
  intervals_with_any_record: number
  intervals_no_record: number
  intervals_hourly_resolution: number
  intervals_only_after_cutoff: number
  intervals_invalid_value: number
  intervals_ambiguous: number
  intervals_valid_at_cutoff: number
  duplicate_records_dropped: number
  conflicting_groups: number
  coverage_ratio: number | null
  half_hourly_start_share: number | null
  start_minute_counts: Record<string, number>
}

export interface AlignmentIssues {
  actual_malformed_records: number
  actual_non_wind_ignored: number
  actual_missing_fuel_type: number
  actual_misaligned_start: number
  actual_settlement_mismatch: number
  actual_naive_timestamps: number
  actual_missing_publish_time: number
  actual_outside_period: number
  forecast_malformed_records: number
  forecast_misaligned_start: number
  forecast_naive_timestamps: number
  forecast_missing_publish_time: number
  forecast_outside_period: number
  overlap_duplicates_actual: number
  overlap_duplicates_forecast: number
}

export interface MissingRun {
  start_time_utc: string
  end_time_utc: string
  intervals: number
  reasons: ExclusionReason[]
}

export interface Chunk {
  dataset: string
  key: string
  window: string
  state: ChunkState
  retrieved_at: string | null
  record_count: number | null
  attempts: number
  duration_ms: number | null
  error: string | null
}

export interface Source {
  dataset: string
  description: string
  raw_records: number
  requests_total: number
  requests_ok: number
  requests_failed: number
  latest_retrieval: string | null
  max_source_publish_time: string | null
  chunks: Chunk[]
}

export interface Quality {
  period: Period
  cutoff: Cutoff
  actual: ActualQuality
  forecast: ForecastQuality
  alignment: AlignmentIssues
  exclusion_counts: Partial<Record<ExclusionReason, number>>
  matched: number
  excluded: number
  missing_runs: MissingRun[]
  sources: Source[]
  data: Freshness
  warnings: Warning[]
}

export interface DatasetStatus {
  state: DatasetState
  ingestion_running: boolean
  stale: boolean
  stale_after_hours: number
  chunks_total: number
  chunks_usable: number
  chunks_failed: number
  progress_completed: number
  progress_total: number
  last_attempt_at: string | null
  last_error: string | null
  retrieved_at_latest: string | null
  retrieved_at_oldest: string | null
  source_max_publish_time_actual: string | null
  source_max_publish_time_forecast: string | null
  records_actual: number
  records_forecast: number
  api_base_url: string
  period: Period
  message: string
}

export interface RefreshResult {
  accepted: boolean
  message: string
  status: DatasetStatus
}

export interface AppConfig {
  version: string
  environment: string
  period: Period
  default_cutoff: Cutoff
  wape_min_mean_actual_mw: number
  min_sample_warning: number
  cache_stale_after_hours: number
  api_base_url: string
  datasets: Record<string, string>
}

export type SortKey =
  'start_time' | 'actual_mw' | 'forecast_mw' | 'signed_error_mw' | 'abs_error_mw' | 'forecast_publish_time'
