import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Histogram } from '@/api/types'
import { formatInt, formatSignedMw, formatPercent } from '@/lib/format'
import { axisProps, C, Legend, TipRow, TooltipCard } from './theme'

interface Row {
  lower: number
  upper: number
  count: number
  share: number
}

export function ErrorHistogram({ histogram, height = 260 }: { histogram: Histogram; height?: number }) {
  const rows: Row[] = histogram.bins.map((b) => ({
    lower: b.lower_mw,
    upper: b.upper_mw,
    count: b.count,
    share: histogram.n > 0 ? b.count / histogram.n : 0,
  }))
  const summary = `Histogram of ${formatInt(histogram.n)} signed errors in bins of ${formatInt(histogram.bin_width_mw)} MW, from ${
    rows.length ? formatSignedMw(rows[0].lower, 0) : '—'
  } to ${rows.length ? formatSignedMw(rows[rows.length - 1].upper, 0) : '—'} MW.`
  return (
    <figure aria-label="Forecast error distribution" className="space-y-2">
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            barCategoryGap={1}
            accessibilityLayer
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="lower"
              {...axisProps}
              interval="preserveStartEnd"
              minTickGap={18}
              tickFormatter={(v: number) => formatSignedMw(v, 0)}
              height={24}
            />
            <YAxis
              {...axisProps}
              width={44}
              allowDecimals={false}
              tickFormatter={(v: number) => formatInt(v)}
              label={{
                value: 'Intervals',
                angle: -90,
                position: 'insideLeft',
                offset: 10,
                fontSize: 11,
                fill: C.axis,
              }}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: 'rgba(14,116,144,0.08)' }}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined
                if (!r) return null
                const dir = r.upper <= 0 ? 'Under-forecast' : 'Over-forecast'
                return (
                  <TooltipCard title={`${formatSignedMw(r.lower, 0)} to ${formatSignedMw(r.upper, 0)} MW`}>
                    <TipRow label="Intervals" value={formatInt(r.count)} />
                    <TipRow label="Share of matched" value={formatPercent(r.share)} />
                    <TipRow label="Direction" value={dir} />
                  </TooltipCard>
                )
              }}
            />
            <Bar dataKey="count" isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.lower} fill={r.upper <= 0 ? C.under : C.over} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600">
        <Legend
          items={[
            { label: 'Under-forecast (error < 0)', color: C.under, kind: 'box' },
            { label: 'Over-forecast (error ≥ 0)', color: C.over, kind: 'box' },
          ]}
        />
        <span className="tnum">
          Bin width {formatInt(histogram.bin_width_mw)} MW · x-axis: forecast − actual (MW)
        </span>
      </div>
    </figure>
  )
}
