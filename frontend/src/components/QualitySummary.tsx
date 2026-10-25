import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Summary } from '@/api/types'
import { formatInt, formatPercent } from '@/lib/format'
import { ALL_REASONS, REASON_LABEL } from '@/lib/reasons'
import { formatInstant, type TimeZoneMode } from '@/lib/time'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="tnum mt-1 text-lg font-semibold text-ink-900">{value}</dd>
      {sub && <dd className="tnum text-xs text-ink-600">{sub}</dd>}
    </div>
  )
}

/** Concise data-quality digest for the Overview; the full report lives on the Data Quality page. */
export function QualitySummary({ summary, tz }: { summary: Summary; tz: TimeZoneMode }) {
  const { coverage: c, exclusion_counts: ex, data } = summary
  const reasons = ALL_REASONS.filter((r) => (ex[r] ?? 0) > 0)
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label="Expected intervals"
          value={formatInt(c.expected_intervals)}
          sub="half-hours in selected dates"
        />
        <Stat
          label="Valid actuals"
          value={formatInt(c.actual_valid)}
          sub={formatPercent(c.actual_coverage_ratio)}
        />
        <Stat
          label="Valid forecasts at cutoff"
          value={formatInt(c.forecast_valid_at_cutoff)}
          sub={formatPercent(c.forecast_coverage_ratio)}
        />
        <Stat
          label="Matched / excluded"
          value={`${formatInt(c.matched)} / ${formatInt(c.excluded)}`}
          sub={formatPercent(c.coverage_ratio)}
        />
      </dl>

      {reasons.length > 0 ? (
        <div>
          <p className="label-caps mb-1.5">Why intervals are excluded</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-700">
            {reasons.map((r) => (
              <li key={r} className="tnum">
                <span className="font-medium text-warn-700">{formatInt(ex[r])}</span>{' '}
                {REASON_LABEL[r].toLowerCase()}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-600">
            An interval can have more than one reason, so counts may exceed the excluded total.
          </p>
        </div>
      ) : (
        c.expected_intervals > 0 && <p className="text-sm text-ink-700">No intervals were excluded.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-3 text-xs text-ink-600">
        <p className="tnum">
          Last retrieved by this app:{' '}
          <span className="font-medium text-ink-800">
            {data.retrieved_at_latest ? formatInstant(data.retrieved_at_latest, tz) : 'never'}
          </span>
          {' · '}Latest forecast published at source:{' '}
          <span className="font-medium text-ink-800">
            {data.source_max_publish_time_forecast
              ? formatInstant(data.source_max_publish_time_forecast, tz)
              : '—'}
          </span>
        </p>
        <Link
          to="/quality"
          className="inline-flex items-center gap-1 font-medium text-cyan-700 hover:underline"
        >
          Full data-quality report <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
