import clsx from 'clsx'
import { useFilters } from '@/state/filters'
import { cutoffToQuery } from '@/lib/cutoff'
import { useIntervalDetail } from '@/api/hooks'
import { biasDirection, formatMw, formatSignedMw } from '@/lib/format'
import { formatInstant } from '@/lib/time'
import { Badge } from './ui/Badge'
import { Drawer } from './ui/Drawer'
import { ErrorState } from './ui/StateBlocks'
import { Skeleton } from './ui/Skeleton'
import { ReasonList, StatusBadge } from './StatusBadge'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tnum text-right font-medium text-ink-900">{children}</dd>
    </div>
  )
}

/** Inspect one half-hour: values, the exact forecast vintage selected, and every vintage considered. */
export function IntervalDetailDrawer({ start, onClose }: { start: string | null; onClose: () => void }) {
  const { cutoff, tz } = useFilters()
  const q = useIntervalDetail(start, cutoffToQuery(cutoff))
  const d = q.data
  const i = d?.interval
  const other = tz === 'UTC' ? 'Europe/London' : 'UTC'

  return (
    <Drawer open={start !== null} title="Interval detail" onClose={onClose}>
      {q.isPending && (
        <div role="status" aria-label="Loading interval" className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {i && d && (
        <div className="space-y-5">
          <div>
            <p className="tnum text-lg font-semibold text-ink-900">{formatInstant(i.start_time_utc, tz)}</p>
            <p className="tnum text-xs text-ink-600">
              {formatInstant(i.start_time_utc, other)} · settlement date {i.settlement_date}, period{' '}
              {i.settlement_period}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge status={i.status} />
            </div>
          </div>

          {i.explanation && (
            <div
              role="note"
              className="rounded-md border border-warn-600/40 bg-warn-50 px-3 py-2 text-sm text-warn-700"
            >
              <p className="font-medium">Excluded from the metrics</p>
              <p className="mt-0.5">{i.explanation}</p>
              <ReasonList reasons={i.reasons} />
            </div>
          )}

          <dl>
            <Row label="Actual (FUELHH, WIND)">{formatMw(i.actual_mw)} MW</Row>
            <Row label="Forecast (WINDFOR, selected vintage)">{formatMw(i.forecast_mw)} MW</Row>
            <Row label="Signed error (forecast − actual)">
              {i.signed_error_mw === null ? (
                '—'
              ) : (
                <>
                  {formatSignedMw(i.signed_error_mw)} MW{' '}
                  <span className="text-xs font-normal text-ink-600">
                    ({biasDirection(i.signed_error_mw)})
                  </span>
                </>
              )}
            </Row>
            <Row label="Absolute error">{formatMw(i.abs_error_mw)} MW</Row>
            <Row label="Decision cutoff for this interval">{formatInstant(i.cutoff_utc, tz)}</Row>
            <Row label="Selected forecast published">{formatInstant(i.forecast_publish_time_utc, tz)}</Row>
            <Row label="Actual records for this half-hour">
              {d.actual_record_count}
              {d.actual_publish_time && (
                <span className="block text-xs font-normal text-ink-600">
                  latest published {formatInstant(d.actual_publish_time, tz)}
                </span>
              )}
            </Row>
          </dl>

          <section aria-labelledby="vintages-h">
            <h3 id="vintages-h" className="text-sm font-semibold text-ink-900">
              Forecast vintages for this half-hour
            </h3>
            <p className="mt-0.5 text-xs text-ink-600">
              Every WINDFOR publication that covers this interval, newest first. Only vintages published at or
              before the cutoff were eligible; the latest of those is selected.
            </p>
            {d.vintages.length === 0 ? (
              <p className="mt-3 text-sm text-ink-600">No WINDFOR record exists for this interval.</p>
            ) : (
              <div className="scroll-thin mt-2 max-h-80 overflow-auto rounded-md border border-line">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Forecast vintages</caption>
                  <thead className="sticky top-0 bg-canvas-sunken text-ink-600">
                    <tr>
                      <th scope="col" className="px-2.5 py-1.5 font-medium">
                        Published
                      </th>
                      <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
                        Forecast (MW)
                      </th>
                      <th scope="col" className="px-2.5 py-1.5 font-medium">
                        Availability
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.vintages.map((v) => (
                      <tr
                        key={v.publish_time}
                        className={clsx(
                          'border-t border-line',
                          v.selected && 'bg-cyan-400/10',
                          !v.published_at_or_before_cutoff && 'text-ink-500',
                        )}
                      >
                        <td className="tnum px-2.5 py-1.5">{formatInstant(v.publish_time, tz)}</td>
                        <td className="tnum px-2.5 py-1.5 text-right">
                          {v.ambiguous ? 'conflict' : formatMw(v.forecast_mw)}
                        </td>
                        <td className="px-2.5 py-1.5">
                          {v.selected ? (
                            <Badge tone="cyan">Selected</Badge>
                          ) : v.published_at_or_before_cutoff ? (
                            'Before cutoff (superseded)'
                          ) : (
                            'After cutoff — not used'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.truncated && (
              <p className="mt-1 text-xs text-ink-600">
                Showing the newest {d.vintages.length} of {d.vintages_total} vintages.
              </p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
