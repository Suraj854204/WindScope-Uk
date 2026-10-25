import clsx from 'clsx'
import type { ReactNode } from 'react'
import { InfoTip } from './ui/InfoTip'
import { KpiSkeleton } from './ui/Skeleton'

export function MetricCard({
  label,
  value,
  unit,
  sub,
  info,
  tone = 'default',
  loading,
  note,
}: {
  label: string
  value: string
  unit?: string
  sub?: ReactNode
  info?: ReactNode
  tone?: 'default' | 'warn'
  loading?: boolean
  /** Extra line, e.g. why a value is "—" */
  note?: ReactNode
}) {
  return (
    <div className="panel flex min-h-[116px] flex-col justify-between p-4" data-testid={`metric-${label}`}>
      {loading ? (
        <KpiSkeleton />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <span className="label-caps">{label}</span>
            {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={clsx(
                'tnum text-[28px] font-semibold leading-none tracking-tight',
                tone === 'warn' ? 'text-warn-700' : 'text-ink-900',
              )}
            >
              {value}
            </span>
            {unit && <span className="text-xs font-medium text-ink-600">{unit}</span>}
          </div>
          <div className="mt-2 min-h-4 text-xs text-ink-600">{sub}</div>
          {note && <div className="mt-1 text-xs text-ink-600">{note}</div>}
        </>
      )}
    </div>
  )
}
