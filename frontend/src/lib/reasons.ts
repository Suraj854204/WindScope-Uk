import type { ExclusionReason } from '@/api/types'

export const REASON_LABEL: Record<ExclusionReason, string> = {
  missing_actual: 'No actual record',
  invalid_actual: 'Actual has no usable value',
  ambiguous_actual: 'Conflicting actuals',
  no_forecast_record: 'No forecast record',
  forecast_hourly_resolution: 'Forecast is hourly only',
  forecast_only_after_cutoff: 'Forecast only after cutoff',
  invalid_forecast: 'Forecast has no usable value',
  ambiguous_forecast: 'Conflicting forecasts',
}

export const REASON_HELP: Record<ExclusionReason, string> = {
  missing_actual: 'FUELHH has no WIND record for this half-hour. It is never treated as zero generation.',
  invalid_actual: 'The FUELHH WIND record exists but its value is null, non-numeric or negative.',
  ambiguous_actual:
    'Several FUELHH WIND records share the latest publishTime with different values, so the actual cannot be determined.',
  no_forecast_record:
    'WINDFOR returned no record at all for this delivery half-hour (for example it is outside the forecast horizon).',
  forecast_hourly_resolution:
    'WINDFOR publishes one value per hour (start times on the hour), so the :30 half-hours have no forecast of their own. They are excluded, never filled in or interpolated.',
  forecast_only_after_cutoff:
    'WINDFOR forecasts exist for this half-hour, but all were published after the decision cutoff, so none could have been used.',
  invalid_forecast:
    'The latest forecast published at or before the cutoff has no usable value. Older vintages are deliberately not substituted.',
  ambiguous_forecast: 'Several WINDFOR records share the selected publishTime with different values.',
}

export const ALL_REASONS = Object.keys(REASON_LABEL) as ExclusionReason[]

export function reasonLabel(r: string): string {
  return REASON_LABEL[r as ExclusionReason] ?? r
}
