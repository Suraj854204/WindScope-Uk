import clsx from 'clsx'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import type { Interval, SortKey } from '@/api/types'
import { formatMw, formatSignedMw, MISSING } from '@/lib/format'
import { formatClock, formatDay, zoneAbbr, type TimeZoneMode } from '@/lib/time'
import { ReasonList, StatusBadge } from './StatusBadge'

export interface SortState {
  by: SortKey
  dir: 'asc' | 'desc'
}

interface Column {
  key: SortKey | null
  label: string
  align?: 'left' | 'right'
  title?: string
}

const COLUMNS: Column[] = [
  { key: 'start_time', label: 'Delivery start' },
  { key: null, label: 'SP', title: 'Settlement period (1-based, Europe/London day)', align: 'right' },
  { key: 'actual_mw', label: 'Actual (MW)', align: 'right', title: 'FUELHH, fuelType = WIND' },
  {
    key: 'forecast_mw',
    label: 'Forecast (MW)',
    align: 'right',
    title: 'WINDFOR: latest forecast published at or before the cutoff',
  },
  {
    key: 'signed_error_mw',
    label: 'Signed error (MW)',
    align: 'right',
    title: 'Forecast − actual. Positive = over-forecast',
  },
  { key: 'abs_error_mw', label: 'Abs error (MW)', align: 'right' },
  {
    key: 'forecast_publish_time',
    label: 'Forecast published',
    title: 'publishTime of the selected forecast vintage',
  },
  { key: null, label: 'Decision cutoff', title: 'Forecasts published after this instant were not eligible' },
  { key: null, label: 'Status' },
]

function Missing({ what }: { what: string }) {
  return (
    <span className="text-ink-500" title={`${what} is missing. It is not treated as zero.`}>
      <span aria-hidden>{MISSING}</span>
      <span className="sr-only">missing</span>
    </span>
  )
}

function TimeCell({ iso, tz, showDay = true }: { iso: string | null; tz: TimeZoneMode; showDay?: boolean }) {
  if (!iso) return <Missing what="This time" />
  return (
    <span className="tnum whitespace-nowrap" title={`UTC ${iso}`}>
      {showDay && <span className="text-ink-600">{formatDay(iso, tz)} </span>}
      {formatClock(iso, tz)} <span className="text-2xs text-ink-500">{zoneAbbr(iso, tz)}</span>
    </span>
  )
}

export function IntervalsTable({
  items,
  tz,
  sort,
  onSort,
  onInspect,
  caption,
  emptyMessage,
}: {
  items: Interval[]
  tz: TimeZoneMode
  sort?: SortState
  onSort?: (by: SortKey) => void
  onInspect: (startUtc: string) => void
  caption: string
  emptyMessage?: string
}) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-strong bg-canvas-sunken">
            {COLUMNS.map((c) => {
              const active = sort && c.key !== null && sort.by === c.key
              const ariaSort = active
                ? sort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : c.key && onSort
                  ? 'none'
                  : undefined
              return (
                <th
                  key={c.label}
                  scope="col"
                  aria-sort={ariaSort}
                  title={c.title}
                  className={clsx(
                    'whitespace-nowrap px-3 py-2 text-2xs font-medium uppercase tracking-[0.06em] text-ink-600',
                    c.align === 'right' && 'text-right',
                  )}
                >
                  {c.key && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key as SortKey)}
                      className={clsx(
                        'inline-flex items-center gap-1 uppercase tracking-[0.06em] transition-colors hover:text-ink-900',
                        c.align === 'right' && 'flex-row-reverse',
                        active && 'text-ink-900',
                      )}
                    >
                      {c.label}
                      {active ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              )
            })}
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Inspect</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-sm text-ink-600">
                <Search className="mx-auto mb-2 size-5 text-ink-500" aria-hidden />
                {emptyMessage ?? 'No intervals match the current filters.'}
              </td>
            </tr>
          )}
          {items.map((i) => (
            <tr
              key={i.start_time_utc}
              className={clsx(
                'border-b border-line transition-colors hover:bg-white',
                i.status === 'excluded' && 'bg-warn-50/50',
              )}
            >
              <td className="px-3 py-2">
                <TimeCell iso={i.start_time_utc} tz={tz} />
              </td>
              <td className="tnum px-3 py-2 text-right text-ink-600">{i.settlement_period}</td>
              <td className="tnum px-3 py-2 text-right">
                {i.actual_mw === null ? <Missing what="Actual" /> : formatMw(i.actual_mw)}
              </td>
              <td className="tnum px-3 py-2 text-right">
                {i.forecast_mw === null ? <Missing what="Forecast" /> : formatMw(i.forecast_mw)}
              </td>
              <td className="tnum px-3 py-2 text-right">
                {i.signed_error_mw === null ? <Missing what="Error" /> : formatSignedMw(i.signed_error_mw)}
              </td>
              <td className="tnum px-3 py-2 text-right">
                {i.abs_error_mw === null ? <Missing what="Error" /> : formatMw(i.abs_error_mw)}
              </td>
              <td className="px-3 py-2">
                <TimeCell iso={i.forecast_publish_time_utc} tz={tz} />
              </td>
              <td className="px-3 py-2">
                <TimeCell iso={i.cutoff_utc} tz={tz} />
              </td>
              <td className="px-3 py-2" title={i.explanation ?? undefined}>
                <StatusBadge status={i.status} />
                <ReasonList reasons={i.reasons} />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onInspect(i.start_time_utc)}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-cyan-700 hover:bg-cyan-400/10 hover:underline"
                  aria-label={`Inspect interval starting ${i.start_time_utc}`}
                >
                  Inspect
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
