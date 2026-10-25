import { AlertTriangle } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Bucket } from '@/api/types'
import { formatInt, formatMw, formatPercent, formatSignedMw } from '@/lib/format'
import { axisProps, C, Legend, TipRow, TooltipCard } from './theme'

export type AccuracySeries = 'mae' | 'rmse' | 'bias'

/** Per-period MAE (bars), RMSE and signed bias (lines). Low-sample buckets are drawn faded. */
export function AccuracyChart({
  buckets,
  series = ['mae', 'rmse', 'bias'],
  height = 280,
  unitLabel = 'day',
}: {
  buckets: Bucket[]
  series?: AccuracySeries[]
  height?: number
  unitLabel?: 'day' | 'week'
}) {
  const showBias = series.includes('bias')
  const lowCount = buckets.filter((b) => b.low_sample).length
  const summary = `${buckets.length} ${unitLabel}ly accuracy buckets. ${lowCount} have fewer than 12 matched intervals and are shown faded.`
  return (
    <figure
      aria-label={`${unitLabel === 'day' ? 'Daily' : 'Weekly'} forecast accuracy`}
      className="space-y-2"
    >
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={buckets} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={14} height={24} />
            <YAxis
              {...axisProps}
              width={56}
              tickFormatter={(v: number) => formatInt(v)}
              label={{
                value: 'MW',
                angle: -90,
                position: 'insideLeft',
                offset: 12,
                fontSize: 11,
                fill: C.axis,
              }}
            />
            {showBias && <ReferenceLine y={0} stroke={C.axis} strokeDasharray="4 3" />}
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: 'rgba(14,116,144,0.08)' }}
              content={({ active, payload }) => {
                const b = active ? (payload?.[0]?.payload as Bucket | undefined) : undefined
                if (!b) return null
                return (
                  <TooltipCard title={b.label}>
                    <TipRow
                      label="Matched / expected"
                      value={`${formatInt(b.n_matched)} / ${formatInt(b.n_expected)}`}
                    />
                    <TipRow label="MAE" value={`${formatMw(b.mae_mw)} MW`} swatch={C.mae} />
                    <TipRow label="RMSE" value={`${formatMw(b.rmse_mw)} MW`} swatch={C.rmse} />
                    <TipRow
                      label="Bias (fcst − act)"
                      value={`${formatSignedMw(b.bias_mw)} MW`}
                      swatch={C.bias}
                      dashed
                    />
                    <TipRow label="WAPE" value={b.wape === null ? 'n/a' : formatPercent(b.wape)} />
                    {(b.low_sample || b.partial_bucket) && (
                      <div className="mt-1.5 rounded bg-warn-50 px-2 py-1 text-warn-700">
                        {b.low_sample ? 'Low sample (<12 matched intervals). ' : ''}
                        {b.partial_bucket ? 'Partial week within the selected dates.' : ''}
                      </div>
                    )}
                  </TooltipCard>
                )
              }}
            />
            {series.includes('mae') && (
              <Bar dataKey="mae_mw" name="MAE" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {buckets.map((b) => (
                  <Cell key={b.bucket_start} fill={C.mae} fillOpacity={b.low_sample ? 0.35 : 1} />
                ))}
              </Bar>
            )}
            {series.includes('rmse') && (
              <Line
                type="monotone"
                dataKey="rmse_mw"
                name="RMSE"
                stroke={C.rmse}
                strokeWidth={1.8}
                dot={{ r: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showBias && (
              <Line
                type="monotone"
                dataKey="bias_mw"
                name="Bias"
                stroke={C.bias}
                strokeWidth={1.6}
                strokeDasharray="5 3"
                dot={{ r: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            ...(series.includes('mae') ? [{ label: 'MAE', color: C.mae, kind: 'box' as const }] : []),
            ...(series.includes('rmse') ? [{ label: 'RMSE', color: C.rmse }] : []),
            ...(showBias
              ? [{ label: 'Signed bias (forecast − actual)', color: C.bias, kind: 'dashed' as const }]
              : []),
          ]}
        />
        {lowCount > 0 && (
          <p className="flex items-center gap-1 text-xs text-warn-700">
            <AlertTriangle className="size-3.5" aria-hidden />
            Faded bars: fewer than 12 matched intervals
          </p>
        )}
      </div>
    </figure>
  )
}
