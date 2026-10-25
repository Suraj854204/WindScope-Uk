import { useMemo, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SeriesPoint } from '@/api/types'
import { formatInt, formatMw, formatSignedMw } from '@/lib/format'
import { reasonLabel } from '@/lib/reasons'
import { dayTicks, formatDay, formatInstant, formatShortDate, type TimeZoneMode } from '@/lib/time'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { axisProps, C, Legend, TipRow, TooltipCard } from './theme'

interface Row {
  t: number
  actual: number | null
  forecast: number | null
  error: number | null
  publish: string | null
  matched: boolean
  reasons: string[]
}

const HALF_HOUR_MS = 30 * 60 * 1000
const WEEK = 7 * 48

/** Contiguous runs of excluded intervals, as [firstIndex, lastIndex]. */
export function excludedRuns(rows: Pick<Row, 'matched'>[]): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  rows.forEach((r, i) => {
    if (!r.matched && start < 0) start = i
    if (r.matched && start >= 0) {
      runs.push([start, i - 1])
      start = -1
    }
  })
  if (start >= 0) runs.push([start, rows.length - 1])
  return runs
}

export function ForecastChart({
  points,
  tz,
  height = 360,
}: {
  points: SeriesPoint[]
  tz: TimeZoneMode
  height?: number
}) {
  const [view, setView] = useState<'generation' | 'error'>('generation')
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [brushKey, setBrushKey] = useState(0)

  const rows = useMemo<Row[]>(
    () =>
      points.map((p) => ({
        t: new Date(p.start_time).getTime(),
        actual: p.actual_mw,
        forecast: p.forecast_mw,
        error: p.signed_error_mw,
        publish: p.forecast_publish_time,
        matched: p.status === 'matched',
        reasons: p.reasons,
      })),
    [points],
  )

  const last = Math.max(0, rows.length - 1)
  const start = Math.min(range?.start ?? 0, last)
  const end = Math.min(range?.end ?? last, last)
  const visible = rows.slice(start, end + 1)
  const ticks = useMemo(
    () =>
      dayTicks(
        visible.map((r) => r.t),
        tz,
        8,
      ),
    [visible, tz],
  )
  const runs = useMemo(
    () =>
      excludedRuns(rows)
        .filter(([a, b]) => b >= start && a <= end)
        .slice(0, 120),
    [rows, start, end],
  )

  const preset = (s: number, e: number) => {
    setRange({ start: s, end: e })
    setBrushKey((k) => k + 1)
  }

  const matched = rows.filter((r) => r.matched).length
  const summary = `Time series of ${formatInt(rows.length)} half-hourly intervals. ${formatInt(matched)} have both an actual and a cutoff-eligible forecast; ${formatInt(rows.length - matched)} are excluded and shown as gaps, not zeros.`

  return (
    <figure aria-label="Actual versus forecast wind generation" className="space-y-3">
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Chart view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'generation', label: 'Generation (MW)' },
            { value: 'error', label: 'Signed error (MW)' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-caps mr-1">Zoom</span>
          <Button size="sm" onClick={() => preset(0, last)} disabled={rows.length === 0}>
            Full period
          </Button>
          <Button size="sm" onClick={() => preset(0, Math.min(last, WEEK - 1))} disabled={rows.length === 0}>
            First 7 days
          </Button>
          <Button
            size="sm"
            onClick={() => preset(Math.max(0, last - WEEK + 1), last)}
            disabled={rows.length === 0}
          >
            Last 7 days
          </Button>
        </div>
      </div>

      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tickFormatter={(t: number) => formatShortDate(t, tz)}
              {...axisProps}
              height={26}
              label={{
                value: `Delivery start (${tz === 'UTC' ? 'UTC' : 'Europe/London'})`,
                position: 'insideBottom',
                offset: -2,
                fontSize: 11,
                fill: C.axis,
              }}
            />
            <YAxis
              {...axisProps}
              width={64}
              tickFormatter={(v: number) => formatInt(v)}
              label={{
                value: view === 'generation' ? 'MW' : 'Forecast − actual (MW)',
                angle: -90,
                position: 'insideLeft',
                offset: 14,
                fontSize: 11,
                fill: C.axis,
              }}
              domain={view === 'generation' ? [0, 'auto'] : ['auto', 'auto']}
            />
            {runs.map(([a, b]) => (
              <ReferenceArea
                key={`${a}-${b}`}
                x1={rows[a].t}
                x2={rows[b].t + HALF_HOUR_MS}
                fill={C.gap}
                fillOpacity={0.55}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
            {view === 'error' && <ReferenceLine y={0} stroke={C.axis} strokeDasharray="4 3" />}
            {view === 'generation' ? (
              <>
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke={C.actual}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast"
                  stroke={C.forecast}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </>
            ) : (
              <Line
                type="monotone"
                dataKey="error"
                name="Signed error"
                stroke={C.under}
                strokeWidth={1.4}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined
                if (!row) return null
                return (
                  <TooltipCard
                    title={`${formatDay(row.t, tz)}, ${formatInstant(row.t, tz).split(' ').slice(3).join(' ')}`}
                  >
                    <TipRow label="Actual (FUELHH)" value={`${formatMw(row.actual)} MW`} swatch={C.actual} />
                    <TipRow
                      label="Forecast (WINDFOR)"
                      value={`${formatMw(row.forecast)} MW`}
                      swatch={C.forecast}
                    />
                    <TipRow
                      label="Forecast − actual"
                      value={row.error === null ? '—' : `${formatSignedMw(row.error)} MW`}
                    />
                    <TipRow
                      label="Forecast published"
                      value={row.publish ? formatInstant(row.publish, tz) : '—'}
                    />
                    {!row.matched && (
                      <div className="mt-1.5 rounded bg-warn-50 px-2 py-1 text-warn-700">
                        Excluded: {row.reasons.map(reasonLabel).join('; ')}
                      </div>
                    )}
                  </TooltipCard>
                )
              }}
            />
            {rows.length > 1 && (
              <Brush
                key={brushKey}
                dataKey="t"
                height={28}
                stroke="#33497A"
                fill="#F4F2EC"
                travellerWidth={9}
                startIndex={start}
                endIndex={end}
                tickFormatter={(t: number) => formatShortDate(t, tz)}
                onChange={(r) => {
                  if (typeof r.startIndex === 'number' && typeof r.endIndex === 'number') {
                    setRange({ start: r.startIndex, end: r.endIndex })
                  }
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={
            view === 'generation'
              ? [
                  { label: 'Actual (FUELHH, WIND)', color: C.actual },
                  { label: 'Forecast (WINDFOR, latest ≤ cutoff)', color: C.forecast },
                  { label: 'Excluded intervals (gap, not zero)', color: C.gap, kind: 'band' },
                ]
              : [
                  { label: 'Forecast − actual (positive = over-forecast)', color: C.under },
                  { label: 'Excluded intervals (gap, not zero)', color: C.gap, kind: 'band' },
                ]
          }
        />
        <p className="tnum text-xs text-ink-600">
          Showing {formatInt(visible.length)} of {formatInt(rows.length)} intervals
        </p>
      </div>
    </figure>
  )
}
