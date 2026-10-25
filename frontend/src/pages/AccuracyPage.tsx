import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useAccuracy, useSensitivity, useSummary } from '@/api/hooks'
import type { Bucket, Metrics } from '@/api/types'
import { DateRangeControl } from '@/components/DateRangeControl'
import { IntervalDetailDrawer } from '@/components/IntervalDetailDrawer'
import { IntervalsTable } from '@/components/IntervalsTable'
import { NoDataNotice } from '@/components/NoDataNotice'
import { WarningList } from '@/components/WarningList'
import { AccuracyChart } from '@/components/charts/AccuracyChart'
import { SensitivityChart } from '@/components/charts/SensitivityChart'
import { Badge } from '@/components/ui/Badge'
import { TextField } from '@/components/ui/Field'
import { PageHeader, Panel } from '@/components/ui/Panel'
import { Segmented } from '@/components/ui/Segmented'
import { ChartSkeleton, TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/StateBlocks'
import { METRIC_DEFINITIONS } from '@/lib/definitions'
import { biasDirection, formatInt, formatMw, formatPercent, formatSignedMw, MISSING } from '@/lib/format'
import { addDays, formatDateRange } from '@/lib/time'
import { useFilters } from '@/state/filters'

export function AccuracyPage() {
  const { analysisQuery, tz, dateFrom, dateTo } = useFilters()
  const [granularity, setGranularity] = useState<'day' | 'week'>('day')
  const acc = useAccuracy({ ...analysisQuery, granularity, top_n: 10 })
  const sens = useSensitivity(analysisQuery)
  const [inspect, setInspect] = useState<string | null>(null)
  const a = acc.data
  const noMatches = !!a && a.metrics.n === 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accuracy Analysis"
        description="How large and in which direction the forecast errors were, and how they changed across the period. Everything here is descriptive: the data cannot show why an error occurred."
      />

      <Panel
        title="Selected dates"
        subtitle={`Delivery dates ${formatDateRange(dateFrom, dateTo)} (Europe/London)`}
      >
        <DateRangeControl />
      </Panel>

      {acc.isError && !a && (
        <Panel>
          <ErrorState error={acc.error} onRetry={() => void acc.refetch()} retrying={acc.isFetching} />
        </Panel>
      )}
      {a && <WarningList warnings={a.warnings} />}

      <Panel
        title="Metric definitions"
        subtitle="All errors are forecast minus actual, in megawatts, over matched intervals only."
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-line">
          {METRIC_DEFINITIONS.map((d) => (
            <li
              key={d.key}
              className="grid gap-x-6 gap-y-1 px-4 py-3 md:grid-cols-[14rem_minmax(0,1fr)_9rem]"
            >
              <div>
                <p className="text-sm font-semibold text-ink-900">{d.name}</p>
                <p className="text-xs text-ink-600">Unit: {d.unit}</p>
              </div>
              <div className="text-sm text-ink-700">
                <p className="font-mono text-xs text-cyan-700">{d.formula}</p>
                <p className="mt-1">{d.plain}</p>
                {d.caution && <p className="mt-1 text-xs text-warn-700">{d.caution}</p>}
              </div>
              <div className="tnum text-right text-lg font-semibold text-ink-900">
                {a ? currentValue(d.key, a.metrics, a.metrics.n) : MISSING}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Period comparison"
        subtitle="Compare two date ranges under the same cutoff. Differences are descriptive and do not explain causes."
      >
        <PeriodComparison />
      </Panel>

      <Panel
        title="Error trend"
        subtitle={`${granularity === 'day' ? 'Daily' : 'Weekly (Mon–Sun)'} MAE, RMSE and signed bias, MW`}
        actions={
          <Segmented
            label="Aggregation"
            size="sm"
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
            ]}
          />
        }
        info="Each period uses only matched intervals. Faded bars have fewer than 12 matched intervals; partial weeks cover fewer than 7 selected days."
      >
        {acc.isPending ? (
          <ChartSkeleton />
        ) : a && !noMatches ? (
          <div className="space-y-4">
            <AccuracyChart buckets={a.buckets} unitLabel={granularity} height={300} />
            <BucketTable buckets={a.buckets} />
          </div>
        ) : a ? (
          <NoDataNotice what="The error trend" />
        ) : null}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Bias direction"
          subtitle="Share of matched intervals where the forecast was above or below actual"
        >
          {acc.isPending ? (
            <ChartSkeleton height={120} />
          ) : a && !noMatches ? (
            <BiasDirectionView d={a.bias_direction} bias={a.metrics.bias_mw} />
          ) : a ? (
            <NoDataNotice what="Bias direction" />
          ) : null}
        </Panel>

        <Panel
          title="Cutoff sensitivity"
          subtitle="How the error would differ if the decision cutoff were different"
          info="Re-runs the vintage selection with alternative cutoffs. It shows how much the answer depends on the assumed decision time; it is not a recommendation."
        >
          {sens.isPending ? (
            <ChartSkeleton />
          ) : sens.isError && !sens.data ? (
            <ErrorState error={sens.error} onRetry={() => void sens.refetch()} retrying={sens.isFetching} />
          ) : sens.data && sens.data.rows.some((r) => r.matched > 0) ? (
            <div className="space-y-3">
              <SensitivityChart rows={sens.data.rows} />
              <p className="text-xs text-ink-600">{sens.data.note}</p>
            </div>
          ) : (
            <NoDataNotice what="Cutoff sensitivity" />
          )}
        </Panel>
      </div>

      <Panel
        title="Highest-error intervals"
        subtitle="The 10 half-hours with the largest absolute error among matched intervals"
        bodyClassName="p-0"
      >
        {acc.isPending ? (
          <TableSkeleton rows={6} cols={7} />
        ) : a ? (
          <>
            <p className="border-b border-line px-4 py-2 text-xs text-ink-600">{a.high_error_note}</p>
            <IntervalsTable
              items={a.high_error_intervals}
              tz={tz}
              onInspect={setInspect}
              caption="Ten highest absolute-error intervals"
              emptyMessage="No matched intervals, so there is no error ranking."
            />
          </>
        ) : null}
      </Panel>

      <IntervalDetailDrawer start={inspect} onClose={() => setInspect(null)} />
    </div>
  )
}

function currentValue(key: string, m: Metrics, n: number): string {
  if (n === 0) return MISSING
  switch (key) {
    case 'mae':
      return `${formatMw(m.mae_mw)} MW`
    case 'rmse':
      return `${formatMw(m.rmse_mw)} MW`
    case 'bias':
      return `${formatSignedMw(m.bias_mw)} MW`
    case 'wape':
      return m.wape === null ? 'n/a' : formatPercent(m.wape)
    default:
      return `n = ${formatInt(n)}`
  }
}

function BucketTable({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <caption className="sr-only">Accuracy metrics per period</caption>
        <thead className="bg-canvas-sunken text-2xs uppercase tracking-[0.06em] text-ink-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Period
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Matched / expected
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              MAE (MW)
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              RMSE (MW)
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Bias (MW)
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-right font-medium"
              title="Σ|error| ÷ Σactual; n/a when the denominator is too small"
            >
              WAPE
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Flags
            </th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.bucket_start} className="border-t border-line">
              <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">
                {b.label}
              </th>
              <td className="tnum px-3 py-2 text-right">
                {formatInt(b.n_matched)} / {formatInt(b.n_expected)}
              </td>
              <td className="tnum px-3 py-2 text-right">{formatMw(b.mae_mw)}</td>
              <td className="tnum px-3 py-2 text-right">{formatMw(b.rmse_mw)}</td>
              <td className="tnum px-3 py-2 text-right">{formatSignedMw(b.bias_mw)}</td>
              <td
                className="tnum px-3 py-2 text-right"
                title={b.wape === null ? 'Denominator too small or no data' : undefined}
              >
                {b.wape === null ? 'n/a' : formatPercent(b.wape)}
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  {b.low_sample && (
                    <Badge tone="warn">
                      <AlertTriangle className="size-3" aria-hidden />
                      Low sample
                    </Badge>
                  )}
                  {b.partial_bucket && <Badge tone="warn">Partial week</Badge>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BiasDirectionView({ d, bias }: { d: import('@/api/types').BiasDirection; bias: number | null }) {
  const under = d.under_share ?? 0
  const over = d.over_share ?? 0
  const exact = Math.max(0, 1 - under - over)
  const label = `${formatPercent(d.under_share)} under-forecast, ${formatPercent(d.over_share)} over-forecast, ${formatPercent(exact)} exact`
  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={label}
        className="flex h-8 w-full overflow-hidden rounded border border-line"
      >
        <div
          style={{ width: `${under * 100}%` }}
          className="flex items-center justify-start bg-teal-700 px-2 text-xs font-medium text-white"
        >
          {under > 0.12 && formatPercent(under, 0)}
        </div>
        <div style={{ width: `${exact * 100}%` }} className="bg-canvas-sunken" />
        <div
          style={{ width: `${over * 100}%` }}
          className="flex items-center justify-end bg-cyan-600 px-2 text-xs font-medium text-white"
        >
          {over > 0.12 && formatPercent(over, 0)}
        </div>
      </div>
      <div className="flex justify-between text-xs text-ink-600">
        <span>← under-forecast (forecast below actual)</span>
        <span>over-forecast (forecast above actual) →</span>
      </div>
      <dl className="tnum grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="label-caps">Under-forecast</dt>
          <dd className="font-semibold text-ink-900">{formatInt(d.under_count)} intervals</dd>
          <dd className="text-xs text-ink-600">mean {formatSignedMw(d.mean_under_mw)} MW</dd>
        </div>
        <div>
          <dt className="label-caps">Over-forecast</dt>
          <dd className="font-semibold text-ink-900">{formatInt(d.over_count)} intervals</dd>
          <dd className="text-xs text-ink-600">mean {formatSignedMw(d.mean_over_mw)} MW</dd>
        </div>
      </dl>
      <p className="text-sm text-ink-700">
        Net bias over the selected dates is{' '}
        <strong className="font-semibold">{formatSignedMw(bias)} MW</strong>
        {biasDirection(bias) ? ` (${biasDirection(bias)} on average)` : ''}. Intervals with errors in opposite
        directions offset each other in the net figure, so read this alongside MAE.
      </p>
    </div>
  )
}

type Range = { from: string; to: string }

function PeriodComparison() {
  const { analysisQuery, bounds } = useFilters()
  const mid = addDays(bounds.min, 15) > bounds.max ? bounds.max : addDays(bounds.min, 15)
  const [A, setA] = useState<Range>({
    from: bounds.min,
    to: addDays(mid, -1) < bounds.min ? bounds.min : addDays(mid, -1),
  })
  const [B, setB] = useState<Range>({ from: mid, to: bounds.max })

  const base = {
    cutoff_mode: analysisQuery.cutoff_mode,
    cutoff_time: analysisQuery.cutoff_time,
    days_before: analysisQuery.days_before,
    lead_hours: analysisQuery.lead_hours,
  }
  const qa = useSummary({ ...base, date_from: A.from, date_to: A.to })
  const qb = useSummary({ ...base, date_from: B.from, date_to: B.to })
  const ma = qa.data?.metrics
  const mb = qb.data?.metrics

  const presets: { label: string; a: Range; b: Range }[] = [
    {
      label: 'First half vs second half',
      a: { from: bounds.min, to: addDays(mid, -1) },
      b: { from: mid, to: bounds.max },
    },
    {
      label: 'Week 1 vs week 2',
      a: { from: bounds.min, to: addDays(bounds.min, 6) },
      b: { from: addDays(bounds.min, 7), to: addDays(bounds.min, 13) },
    },
    {
      label: 'Week 3 vs week 4',
      a: { from: addDays(bounds.min, 14), to: addDays(bounds.min, 20) },
      b: { from: addDays(bounds.min, 21), to: addDays(bounds.min, 27) },
    },
  ]
  const clamp = (r: Range): Range => ({
    from: r.from < bounds.min ? bounds.min : r.from > bounds.max ? bounds.max : r.from,
    to: r.to > bounds.max ? bounds.max : r.to < bounds.min ? bounds.min : r.to,
  })

  const rows: {
    label: string
    unit: string
    a: number | null | undefined
    b: number | null | undefined
    fmt: (v: number | null | undefined) => string
    delta?: (d: number) => string
  }[] = [
    {
      label: 'Matched intervals',
      unit: '',
      a: ma?.n,
      b: mb?.n,
      fmt: formatInt,
      delta: (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatInt(Math.abs(d))}`,
    },
    {
      label: 'MAE',
      unit: 'MW',
      a: ma?.mae_mw,
      b: mb?.mae_mw,
      fmt: formatMw,
      delta: (d) => formatSignedMw(d),
    },
    {
      label: 'RMSE',
      unit: 'MW',
      a: ma?.rmse_mw,
      b: mb?.rmse_mw,
      fmt: formatMw,
      delta: (d) => formatSignedMw(d),
    },
    {
      label: 'Bias (forecast − actual)',
      unit: 'MW',
      a: ma?.bias_mw,
      b: mb?.bias_mw,
      fmt: formatSignedMw,
      delta: (d) => formatSignedMw(d),
    },
    {
      label: 'WAPE',
      unit: '%',
      a: ma?.wape,
      b: mb?.wape,
      fmt: (v) => (v == null ? 'n/a' : formatPercent(v)),
      delta: (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${(Math.abs(d) * 100).toFixed(1)} pp`,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Comparison presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setA(clamp(p.a))
              setB(clamp(p.b))
            }}
            className="h-8 rounded border border-line-strong bg-canvas-raised px-2.5 text-xs font-medium text-ink-800 transition-colors hover:border-ink-500 hover:bg-white"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ['Period A', A, setA],
            ['Period B', B, setB],
          ] as const
        ).map(([name, r, set]) => (
          <fieldset key={name} className="rounded-md border border-line p-3">
            <legend className="px-1 text-xs font-semibold text-ink-800">{name}</legend>
            <div className="flex gap-3">
              <TextField
                label="From"
                type="date"
                min={bounds.min}
                max={r.to}
                value={r.from}
                onChange={(e) => e.target.value && set({ ...r, from: e.target.value })}
              />
              <TextField
                label="To"
                type="date"
                min={r.from}
                max={bounds.max}
                value={r.to}
                onChange={(e) => e.target.value && set({ ...r, to: e.target.value })}
              />
            </div>
          </fieldset>
        ))}
      </div>

      {(qa.isError || qb.isError) && !(ma && mb) ? (
        <ErrorState
          error={qa.error ?? qb.error}
          onRetry={() => {
            void qa.refetch()
            void qb.refetch()
          }}
          retrying={qa.isFetching || qb.isFetching}
        />
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Metric comparison between period A and period B</caption>
            <thead className="bg-canvas-sunken text-2xs uppercase tracking-[0.06em] text-ink-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Metric
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  A · {formatDateRange(A.from, A.to)}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  B · {formatDateRange(B.from, B.to)}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  B − A
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = r.a != null && r.b != null ? r.b - r.a : null
                return (
                  <tr key={r.label} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 font-medium text-ink-900">
                      {r.label} {r.unit && <span className="font-normal text-ink-600">({r.unit})</span>}
                    </th>
                    <td className="tnum px-3 py-2 text-right">{qa.isPending ? '…' : r.fmt(r.a)}</td>
                    <td className="tnum px-3 py-2 text-right">{qb.isPending ? '…' : r.fmt(r.b)}</td>
                    <td className="tnum px-3 py-2 text-right text-ink-700">
                      {d === null || !r.delta ? MISSING : r.delta(d)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-xs text-ink-600">
        {[
          ['A', ma],
          ['B', mb],
        ].map(([k, m]) => {
          const mm = m as Metrics | undefined
          return mm?.sample_warning ? (
            <p key={k as string} className="flex items-start gap-1.5 text-warn-700">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              Period {k as string}: {mm.sample_warning}
            </p>
          ) : null
        })}
        {[
          ['A', ma],
          ['B', mb],
        ].map(([k, m]) => {
          const mm = m as Metrics | undefined
          return mm && mm.wape === null && mm.wape_note ? (
            <p key={`w${k as string}`}>
              Period {k as string}: {mm.wape_note}
            </p>
          ) : null
        })}
        <p>
          WAPE differences are shown in percentage points (pp). Periods of different length or sample size are
          not strictly like-for-like.
        </p>
      </div>
    </div>
  )
}
