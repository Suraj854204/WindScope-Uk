import type { ReactNode } from 'react'

/** Chart palette: cyan/teal accents on warm graphite; amber is reserved for data gaps/warnings. */
export const C = {
  actual: '#0A1224',
  forecast: '#0891B2',
  over: '#0891B2',
  under: '#0F766E',
  mae: '#0F766E',
  rmse: '#0891B2',
  bias: '#363D4E',
  grid: '#DFDBCF',
  axis: '#4A5265',
  gap: '#FBE8B4',
  warn: '#B45309',
} as const

export const axisProps = {
  tick: { fontSize: 11, fill: C.axis },
  tickLine: { stroke: C.grid },
  axisLine: { stroke: C.grid },
} as const

export function TooltipCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="tnum min-w-[13rem] max-w-[18rem] rounded-md bg-navy-900 px-3 py-2 text-xs text-navy-100 shadow-pop">
      <div className="mb-1.5 border-b border-navy-700 pb-1.5 font-medium text-white">{title}</div>
      <dl className="space-y-1">{children}</dl>
    </div>
  )
}

export function TipRow({
  label,
  value,
  swatch,
  dashed,
}: {
  label: string
  value: ReactNode
  swatch?: string
  dashed?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-navy-200">
        {swatch && (
          <span
            aria-hidden
            className="inline-block h-0.5 w-3"
            style={{
              background: dashed
                ? `repeating-linear-gradient(90deg, ${swatch} 0 3px, transparent 3px 5px)`
                : swatch,
              height: 2,
            }}
          />
        )}
        {label}
      </dt>
      <dd className="font-medium text-white">{value}</dd>
    </div>
  )
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; kind?: 'line' | 'dashed' | 'box' | 'band' }[]
}) {
  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-700"
      aria-label="Chart legend"
    >
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.kind === 'box' || i.kind === 'band' ? (
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-[2px]"
              style={{ background: i.color, border: i.kind === 'band' ? `1px solid ${C.warn}` : undefined }}
            />
          ) : (
            <span
              aria-hidden
              className="inline-block w-4"
              style={{
                height: 2,
                background:
                  i.kind === 'dashed'
                    ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)`
                    : i.color,
              }}
            />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  )
}
