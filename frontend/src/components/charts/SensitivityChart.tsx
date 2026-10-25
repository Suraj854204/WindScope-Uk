import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SensitivityRow } from '@/api/types'
import { formatInt, formatMw, formatPercent, formatSignedMw } from '@/lib/format'
import { axisProps, C, Legend, TipRow, TooltipCard } from './theme'

/** MAE as a function of the assumed cutoff - descriptive only, not a recommendation. */
export function SensitivityChart({ rows, height = 240 }: { rows: SensitivityRow[]; height?: number }) {
  return (
    <figure aria-label="Mean absolute error by assumed cutoff" className="space-y-2">
      <figcaption className="sr-only">
        MAE for {rows.length} alternative cutoffs, on each cutoff's own matched sample and on the sample
        common to all.
      </figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} height={24} />
            <YAxis
              {...axisProps}
              width={56}
              tickFormatter={(v: number) => formatInt(v)}
              domain={['auto', 'auto']}
              label={{
                value: 'MAE (MW)',
                angle: -90,
                position: 'insideLeft',
                offset: 12,
                fontSize: 11,
                fill: C.axis,
              }}
            />
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as SensitivityRow | undefined) : undefined
                if (!r) return null
                return (
                  <TooltipCard title={`Cutoff ${r.label}${r.is_selected ? ' (selected)' : ''}`}>
                    <TipRow
                      label="Matched"
                      value={`${formatInt(r.matched)} (${formatPercent(r.coverage_ratio)})`}
                    />
                    <TipRow label="MAE, own sample" value={`${formatMw(r.mae_mw)} MW`} swatch={C.mae} />
                    <TipRow
                      label="MAE, common sample"
                      value={`${formatMw(r.common_mae_mw)} MW`}
                      swatch={C.rmse}
                      dashed
                    />
                    <TipRow label="Bias, own sample" value={`${formatSignedMw(r.bias_mw)} MW`} />
                    <TipRow label="Common sample size" value={formatInt(r.common_matched)} />
                  </TooltipCard>
                )
              }}
            />
            <Line
              type="monotone"
              dataKey="mae_mw"
              stroke={C.mae}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls={false}
              dot={(p: { cx?: number; cy?: number; payload?: SensitivityRow; index?: number }) => (
                <circle
                  key={p.index}
                  cx={p.cx}
                  cy={p.cy}
                  r={p.payload?.is_selected ? 5 : 3}
                  fill={p.payload?.is_selected ? '#0A1224' : C.mae}
                  stroke="#fff"
                  strokeWidth={1}
                />
              )}
            />
            <Line
              type="monotone"
              dataKey="common_mae_mw"
              stroke={C.rmse}
              strokeWidth={1.6}
              strokeDasharray="5 3"
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          { label: 'MAE on each cutoff’s own matched sample', color: C.mae },
          { label: 'MAE on the common sample (like-for-like)', color: C.rmse, kind: 'dashed' },
        ]}
      />
    </figure>
  )
}
