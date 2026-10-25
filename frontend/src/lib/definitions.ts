/** Single source of truth for metric wording, used by tooltips, Accuracy Analysis and Methodology. */

export interface MetricDefinition {
  key: 'mae' | 'rmse' | 'bias' | 'wape' | 'coverage'
  name: string
  unit: string
  formula: string
  plain: string
  caution?: string
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'mae',
    name: 'MAE (mean absolute error)',
    unit: 'MW',
    formula: 'MAE = (1/n) × Σ |forecast − actual|',
    plain:
      'The typical size of a miss, ignoring direction. A MAE of 500 MW means forecasts were off by 500 MW on average.',
  },
  {
    key: 'rmse',
    name: 'RMSE (root mean squared error)',
    unit: 'MW',
    formula: 'RMSE = √[ (1/n) × Σ (forecast − actual)² ]',
    plain:
      'Like MAE but squares each error first, so large misses weigh more. RMSE well above MAE means a few big errors.',
  },
  {
    key: 'bias',
    name: 'Signed bias (forecast − actual)',
    unit: 'MW',
    formula: 'Bias = (1/n) × Σ (forecast − actual)',
    plain:
      'Positive = forecasts were too high on average (over-forecast); negative = too low (under-forecast). Errors in opposite directions cancel, so bias can be near zero while MAE is large.',
  },
  {
    key: 'wape',
    name: 'WAPE (weighted absolute percentage error)',
    unit: '% of actual generation',
    formula: 'WAPE = Σ |forecast − actual| ÷ Σ actual',
    plain:
      'Total absolute error as a share of total actual generation over the matched intervals. It avoids the blow-up of per-interval percentage errors when output is near zero.',
    caution:
      'Only reported when mean actual generation over the matched sample is at least the configured minimum (see Methodology). Otherwise it is shown as n/a, never as a misleading number.',
  },
  {
    key: 'coverage',
    name: 'Matched-interval coverage',
    unit: '% of expected half-hours',
    formula: 'Coverage = matched intervals ÷ expected intervals',
    plain:
      'Share of the half-hours in the selected dates that have BOTH a valid actual and a valid forecast available at the cutoff. Metrics are computed on matched intervals only.',
  },
]

export const defOf = (key: MetricDefinition['key']): MetricDefinition => {
  const d = METRIC_DEFINITIONS.find((m) => m.key === key)
  if (!d) throw new Error(`unknown metric ${key}`)
  return d
}
