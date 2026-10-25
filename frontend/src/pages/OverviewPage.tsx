import { useSeries, useSummary } from '@/api/hooks'
import { MetricCard } from '@/components/MetricCard'
import { NoDataNotice } from '@/components/NoDataNotice'
import { QualitySummary } from '@/components/QualitySummary'
import { WarningList } from '@/components/WarningList'
import { AccuracyChart } from '@/components/charts/AccuracyChart'
import { ErrorHistogram } from '@/components/charts/ErrorHistogram'
import { ForecastChart } from '@/components/charts/ForecastChart'
import { PageHeader, Panel } from '@/components/ui/Panel'
import { ChartSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/StateBlocks'
import { defOf } from '@/lib/definitions'
import { biasDirection, formatInt, formatMw, formatPercent, formatSignedMw } from '@/lib/format'
import { formatDateRange } from '@/lib/time'
import { useFilters } from '@/state/filters'

export function OverviewPage() {
  const { analysisQuery, tz, dateFrom, dateTo } = useFilters()
  const summary = useSummary(analysisQuery)
  const series = useSeries(analysisQuery)
  const s = summary.data
  const m = s?.metrics
  const noMatches = !!s && s.metrics.n === 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={
          <>
            How far was the latest wind forecast available at the purchase decision from actual national wind
            generation?{' '}
            {s ? (
              <>
                Forecast = latest WINDFOR published at or before{' '}
                <strong className="font-medium text-ink-800">{s.cutoff.description}</strong>; actual = FUELHH
                WIND. {formatDateRange(dateFrom, dateTo)}.
              </>
            ) : (
              <>Delivery dates {formatDateRange(dateFrom, dateTo)}.</>
            )}
          </>
        }
      />

      {summary.isError && !s && (
        <Panel>
          <ErrorState
            error={summary.error}
            onRetry={() => void summary.refetch()}
            retrying={summary.isFetching}
          />
        </Panel>
      )}
      {summary.isError && s && (
        <WarningList
          warnings={[
            {
              code: 'refresh_failed',
              severity: 'warning',
              message: 'The latest refresh failed; showing the previous results.',
            },
          ]}
        />
      )}
      {s && <WarningList warnings={s.warnings} />}

      {!(summary.isError && !s) && (
        <>
          <section aria-label="Key accuracy metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard
              label="MAE"
              unit="MW"
              loading={summary.isPending}
              value={formatMw(m?.mae_mw)}
              sub={m ? `n = ${formatInt(m.n)} matched intervals` : undefined}
              info={<MetricInfo k="mae" />}
            />
            <MetricCard
              label="RMSE"
              unit="MW"
              loading={summary.isPending}
              value={formatMw(m?.rmse_mw)}
              sub={
                m?.mae_mw != null && m.rmse_mw != null && m.mae_mw > 0
                  ? `${(m.rmse_mw / m.mae_mw).toFixed(2)}× MAE`
                  : undefined
              }
              info={<MetricInfo k="rmse" />}
            />
            <MetricCard
              label="Bias"
              unit="MW"
              loading={summary.isPending}
              value={formatSignedMw(m?.bias_mw)}
              sub={biasDirection(m?.bias_mw) ? `${biasDirection(m?.bias_mw)} on average` : undefined}
              info={<MetricInfo k="bias" />}
            />
            <MetricCard
              label="WAPE"
              loading={summary.isPending}
              value={m?.wape == null ? 'n/a' : formatPercent(m.wape)}
              sub={m?.wape == null ? undefined : 'of actual generation'}
              note={m?.wape == null && m ? m.wape_note : undefined}
              info={<MetricInfo k="wape" />}
            />
            <MetricCard
              label="Coverage"
              loading={summary.isPending}
              value={formatPercent(s?.coverage.coverage_ratio)}
              sub={
                s
                  ? `${formatInt(s.coverage.matched)} of ${formatInt(s.coverage.expected_intervals)} intervals matched`
                  : undefined
              }
              tone={
                s && s.coverage.coverage_ratio !== null && s.coverage.coverage_ratio < 0.9
                  ? 'warn'
                  : 'default'
              }
              info={<MetricInfo k="coverage" />}
            />
          </section>

          <Panel
            title="Actual vs forecast wind generation"
            subtitle={
              s
                ? `Half-hourly, MW · forecast vintage: latest WINDFOR published ≤ ${s.cutoff.description}`
                : 'Half-hourly, MW'
            }
            info="Black line: actual national wind generation (FUELHH). Cyan line: the forecast that was available at the decision cutoff. Shaded amber bands are intervals excluded from the metrics because data is missing; they are gaps, not zero generation."
          >
            {series.isPending ? (
              <ChartSkeleton height={380} label="Loading generation chart" />
            ) : series.isError && !series.data ? (
              <ErrorState
                error={series.error}
                onRetry={() => void series.refetch()}
                retrying={series.isFetching}
              />
            ) : series.data &&
              series.data.points.some((p) => p.actual_mw !== null || p.forecast_mw !== null) ? (
              <ForecastChart points={series.data.points} tz={tz} />
            ) : (
              <NoDataNotice what="The generation chart" />
            )}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="Forecast error distribution"
              subtitle="Signed error (forecast − actual) per matched half-hour"
              info="How errors are spread. Bars left of zero are under-forecasts (forecast below actual); right of zero are over-forecasts. A wide spread means less predictable errors."
            >
              {summary.isPending ? (
                <ChartSkeleton label="Loading distribution" />
              ) : s && !noMatches ? (
                <ErrorHistogram histogram={s.histogram} />
              ) : s ? (
                <NoDataNotice what="The distribution" />
              ) : null}
            </Panel>

            <Panel
              title="Daily accuracy"
              subtitle="MAE (bars) and signed bias (dashed) per London delivery day, MW"
              info="One bar per day. Faded bars have fewer than 12 matched intervals, so treat them with caution."
            >
              {summary.isPending ? (
                <ChartSkeleton label="Loading daily accuracy" />
              ) : s && !noMatches ? (
                <AccuracyChart buckets={s.daily} series={['mae', 'bias']} unitLabel="day" />
              ) : s ? (
                <NoDataNotice what="Daily accuracy" />
              ) : null}
            </Panel>
          </div>

          <Panel
            title="Data-quality summary"
            subtitle="Coverage, exclusions and retrieval times for the selected dates"
          >
            {s ? (
              <QualitySummary summary={s} tz={tz} />
            ) : (
              <ChartSkeleton height={96} label="Loading data quality" />
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

function MetricInfo({ k }: { k: 'mae' | 'rmse' | 'bias' | 'wape' | 'coverage' }) {
  const d = defOf(k)
  return (
    <>
      <span className="block font-mono text-[11px] text-cyan-300">{d.formula}</span>
      <span className="mt-1 block">{d.plain}</span>
      <span className="mt-1 block text-navy-300">Unit: {d.unit}</span>
    </>
  )
}
