import clsx from 'clsx'
import { CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useDatasetStatus, useQuality, useRefresh } from '@/api/hooks'
import type { Chunk, ChunkState, DatasetState, Quality } from '@/api/types'
import { DateRangeControl } from '@/components/DateRangeControl'
import { WarningList } from '@/components/WarningList'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader, Panel } from '@/components/ui/Panel'
import { ChartSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/StateBlocks'
import { formatInt, formatPercent, MISSING } from '@/lib/format'
import { ALL_REASONS, REASON_HELP, REASON_LABEL, reasonLabel } from '@/lib/reasons'
import { formatInstant } from '@/lib/time'
import { useFilters } from '@/state/filters'

const STATE_TONE: Record<DatasetState, Tone> = {
  ready: 'teal',
  loading: 'cyan',
  partial: 'warn',
  failed: 'bad',
  empty: 'neutral',
}
const CHUNK_TONE: Record<ChunkState, Tone> = {
  cached: 'teal',
  downloaded: 'teal',
  cached_stale: 'warn',
  failed: 'bad',
  pending: 'neutral',
}
const CHUNK_LABEL: Record<ChunkState, string> = {
  cached: 'From cache',
  downloaded: 'Downloaded',
  cached_stale: 'Stale cache (refresh failed)',
  failed: 'Failed',
  pending: 'Pending',
}

function Rows({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <table className="w-full text-left text-[13px]">
      <caption className="sr-only">{caption}</caption>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  )
}

function Row({
  label,
  value,
  help,
  flag,
}: {
  label: string
  value: ReactNode
  help?: string
  flag?: boolean
}) {
  return (
    <tr>
      <th scope="row" className="py-2 pr-4 align-top font-normal text-ink-700">
        {label}
        {help && <span className="mt-0.5 block text-xs text-ink-600">{help}</span>}
      </th>
      <td
        className={clsx(
          'tnum whitespace-nowrap py-2 text-right align-top font-semibold',
          flag ? 'text-warn-700' : 'text-ink-900',
        )}
      >
        {value}
      </td>
    </tr>
  )
}

export function QualityPage() {
  const { analysisQuery, tz } = useFilters()
  const quality = useQuality(analysisQuery)
  const status = useDatasetStatus()
  const refresh = useRefresh()
  const [confirmForce, setConfirmForce] = useState(false)
  const q = quality.data
  const st = status.data

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Quality"
        description="What was retrieved, what is missing, and why intervals were excluded. Missing records are never treated as zero generation."
      />

      <Panel
        title="Selected dates and cutoff"
        subtitle={q ? `Forecast availability is evaluated against: ${q.cutoff.description}` : undefined}
      >
        <DateRangeControl />
      </Panel>

      {quality.isError && !q && (
        <Panel>
          <ErrorState
            error={quality.error}
            onRetry={() => void quality.refetch()}
            retrying={quality.isFetching}
          />
        </Panel>
      )}
      {q && <WarningList warnings={q.warnings} />}

      <Panel
        title="Source status"
        subtitle="Retrieval time is when this app downloaded the data. Source publication time is the latest publishTime inside Elexon's records. They are different things."
        actions={
          <>
            <Button
              size="sm"
              loading={refresh.isPending && !confirmForce}
              disabled={st?.ingestion_running}
              icon={<RefreshCw className="size-3.5" aria-hidden />}
              onClick={() => refresh.mutate(false)}
            >
              {st && (st.state === 'failed' || st.state === 'partial')
                ? 'Retry failed requests'
                : 'Refresh missing data'}
            </Button>
            {confirmForce ? (
              <span className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    refresh.mutate(true)
                    setConfirmForce(false)
                  }}
                >
                  Confirm: re-download all {st?.chunks_total ?? ''} requests
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmForce(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button size="sm" onClick={() => setConfirmForce(true)} disabled={st?.ingestion_running}>
                Force full re-download
              </Button>
            )}
          </>
        }
      >
        {status.isPending ? (
          <ChartSkeleton height={120} />
        ) : status.isError && !st ? (
          <ErrorState
            error={status.error}
            onRetry={() => void status.refetch()}
            retrying={status.isFetching}
          />
        ) : st ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATE_TONE[st.state]}>
                {st.state === 'ready' && st.stale ? 'ready · stale' : st.state}
              </Badge>
              <span className="text-sm text-ink-700">{st.message}</span>
            </div>
            {st.ingestion_running && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={st.progress_total}
                aria-valuenow={st.progress_completed}
                aria-label="Download progress"
                className="h-2 w-full overflow-hidden rounded bg-canvas-sunken"
              >
                <div
                  className="h-full bg-cyan-600 transition-[width] duration-300"
                  style={{
                    width: `${st.progress_total ? (st.progress_completed / st.progress_total) * 100 : 0}%`,
                  }}
                />
              </div>
            )}
            {refresh.data && !refresh.data.accepted && (
              <p role="status" className="text-sm text-warn-700">
                {refresh.data.message}
              </p>
            )}
            {refresh.isError && (
              <p role="alert" className="text-sm text-bad-700">
                Could not reach the API to start the download.
              </p>
            )}
            <div className="grid gap-x-8 gap-y-1 lg:grid-cols-2">
              <Rows caption="Retrieval and publication times">
                <Row
                  label="Latest successful retrieval (by this app)"
                  value={st.retrieved_at_latest ? formatInstant(st.retrieved_at_latest, tz) : 'never'}
                />
                <Row
                  label="Oldest retrieval still in use"
                  value={st.retrieved_at_oldest ? formatInstant(st.retrieved_at_oldest, tz) : MISSING}
                  help={`Flagged stale after ${st.stale_after_hours} h, or when a refresh failed and cached data is served.`}
                  flag={st.stale}
                />
                <Row
                  label="Latest actual publishTime (source, FUELHH)"
                  value={
                    st.source_max_publish_time_actual
                      ? formatInstant(st.source_max_publish_time_actual, tz)
                      : MISSING
                  }
                />
                <Row
                  label="Latest forecast publishTime (source, WINDFOR)"
                  value={
                    st.source_max_publish_time_forecast
                      ? formatInstant(st.source_max_publish_time_forecast, tz)
                      : MISSING
                  }
                />
              </Rows>
              <Rows caption="Request outcomes">
                <Row
                  label="Requests usable / planned"
                  value={`${formatInt(st.chunks_usable)} / ${formatInt(st.chunks_total)}`}
                />
                <Row
                  label="Requests failed"
                  value={formatInt(st.chunks_failed)}
                  flag={st.chunks_failed > 0}
                />
                <Row
                  label="Last download attempt"
                  value={st.last_attempt_at ? formatInstant(st.last_attempt_at, tz) : 'none'}
                />
                <Row
                  label="Raw records: FUELHH WIND / WINDFOR"
                  value={`${formatInt(st.records_actual)} / ${formatInt(st.records_forecast)}`}
                />
              </Rows>
            </div>
            {st.last_error && (
              <p
                role="note"
                className="rounded-md border border-bad-600/40 bg-bad-50 px-3 py-2 font-mono text-xs text-bad-700"
              >
                Last error: {st.last_error}
              </p>
            )}
          </div>
        ) : null}
      </Panel>

      {quality.isPending && (
        <Panel>
          <ChartSkeleton height={220} />
        </Panel>
      )}

      {q && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="Actuals · FUELHH (fuelType = WIND)"
              subtitle="Expected versus observed half-hourly intervals"
            >
              <Rows caption="Actual generation coverage">
                <Row
                  label="Expected intervals"
                  value={formatInt(q.actual.expected_intervals)}
                  help="Half-hours in the selected London dates (46/48/50 per day around clock changes)."
                />
                <Row label="Intervals with a record" value={formatInt(q.actual.intervals_with_record)} />
                <Row
                  label="Missing (no record)"
                  value={formatInt(q.actual.intervals_missing)}
                  flag={q.actual.intervals_missing > 0}
                />
                <Row
                  label="Record present but no usable value"
                  value={formatInt(q.actual.intervals_invalid_value)}
                  flag={q.actual.intervals_invalid_value > 0}
                  help="Null, non-numeric or negative."
                />
                <Row
                  label="Ambiguous (conflicting duplicates)"
                  value={formatInt(q.actual.intervals_ambiguous)}
                  flag={q.actual.intervals_ambiguous > 0}
                />
                <Row
                  label="Valid actuals"
                  value={`${formatInt(q.actual.intervals_valid)} (${formatPercent(q.actual.coverage_ratio)})`}
                />
              </Rows>
            </Panel>

            <Panel
              title="Forecasts · WINDFOR at the decision cutoff"
              subtitle="Availability of a usable forecast for each expected interval"
            >
              <Rows caption="Forecast coverage at cutoff">
                <Row label="Expected intervals" value={formatInt(q.forecast.expected_intervals)} />
                <Row
                  label="Intervals with any forecast record"
                  value={formatInt(q.forecast.intervals_with_any_record)}
                />
                <Row
                  label="No forecast record at all"
                  value={formatInt(q.forecast.intervals_no_record)}
                  flag={q.forecast.intervals_no_record > 0}
                  help="Typically outside the forecast horizon or in a failed request window."
                />
                <Row
                  label="No forecast: WINDFOR is hourly (:30 half-hours)"
                  value={formatInt(q.forecast.intervals_hourly_resolution)}
                  flag={q.forecast.intervals_hourly_resolution > 0}
                  help="Resolution mismatch, not missing data: WINDFOR has one value per hour and FUELHH has two. These half-hours are excluded, not interpolated."
                />
                <Row
                  label="Forecasts exist but all published after cutoff"
                  value={formatInt(q.forecast.intervals_only_after_cutoff)}
                  flag={q.forecast.intervals_only_after_cutoff > 0}
                  help="Not usable: they were not available at decision time."
                />
                <Row
                  label="Selected forecast has no usable value"
                  value={formatInt(q.forecast.intervals_invalid_value + q.forecast.intervals_ambiguous)}
                  flag={q.forecast.intervals_invalid_value + q.forecast.intervals_ambiguous > 0}
                />
                <Row
                  label="Valid forecasts at cutoff"
                  value={`${formatInt(q.forecast.intervals_valid_at_cutoff)} (${formatPercent(q.forecast.coverage_ratio)})`}
                />
              </Rows>
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="Exclusions"
              subtitle={`${formatInt(q.matched)} matched · ${formatInt(q.excluded)} excluded of ${formatInt(q.period.expected_intervals)} expected`}
            >
              <ul className="space-y-2.5">
                {ALL_REASONS.map((r) => {
                  const n = q.exclusion_counts[r] ?? 0
                  return (
                    <li key={r} className="flex items-start justify-between gap-4 text-sm">
                      <span>
                        <span className={clsx('font-medium', n > 0 ? 'text-ink-900' : 'text-ink-600')}>
                          {REASON_LABEL[r]}
                        </span>
                        <span className="block text-xs text-ink-600">{REASON_HELP[r]}</span>
                      </span>
                      <span className={clsx('tnum font-semibold', n > 0 ? 'text-warn-700' : 'text-ink-500')}>
                        {formatInt(n)}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-600">
                An interval can have more than one reason, so these counts can add up to more than the
                excluded total.
              </p>
            </Panel>

            <Panel
              title="Duplicates and conflicts"
              subtitle="How repeated records were resolved (rules on the Methodology page)"
            >
              <Rows caption="Duplicate handling">
                <Row
                  label="Actuals: intervals with more than one record"
                  value={formatInt(q.actual.duplicate_groups)}
                />
                <Row
                  label="Actuals: extra records dropped"
                  value={formatInt(q.actual.duplicate_records_dropped)}
                  help="Latest publishTime wins."
                />
                <Row
                  label="Actuals: conflicting latest records"
                  value={formatInt(q.actual.conflicting_groups)}
                  flag={q.actual.conflicting_groups > 0}
                  help="Same latest publishTime, different values: interval excluded."
                />
                <Row
                  label="Forecasts: duplicate records dropped"
                  value={formatInt(q.forecast.duplicate_records_dropped)}
                  help="Same startTime and publishTime."
                />
                <Row
                  label="Forecasts: conflicting vintages"
                  value={formatInt(q.forecast.conflicting_groups)}
                  flag={q.forecast.conflicting_groups > 0}
                  help="Same startTime and publishTime, different values."
                />
                <Row
                  label="Overlap between request windows (actuals / forecasts)"
                  value={`${formatInt(q.alignment.overlap_duplicates_actual)} / ${formatInt(q.alignment.overlap_duplicates_forecast)}`}
                  help="Identical records returned by two adjacent requests (window boundaries); collapsed before analysis."
                />
              </Rows>
            </Panel>
          </div>

          <AlignmentPanel q={q} />

          <Panel
            title="Largest gaps"
            subtitle="Longest runs of consecutive excluded intervals (UTC and local)"
            bodyClassName="p-0"
          >
            {q.missing_runs.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-ink-700">
                <CheckCircle2 className="size-4 text-teal-700" aria-hidden />
                No excluded intervals in the selected dates.
              </p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
                  <caption className="sr-only">Runs of excluded intervals</caption>
                  <thead className="bg-canvas-sunken text-2xs uppercase tracking-[0.06em] text-ink-600">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        From
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        To (exclusive)
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        Intervals
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.missing_runs.map((r) => (
                      <tr key={r.start_time_utc} className="border-t border-line">
                        <td className="tnum px-4 py-2">{formatInstant(r.start_time_utc, tz)}</td>
                        <td className="tnum px-4 py-2">{formatInstant(r.end_time_utc, tz)}</td>
                        <td className="tnum px-4 py-2 text-right font-semibold">{formatInt(r.intervals)}</td>
                        <td className="px-4 py-2 text-warn-700">{r.reasons.map(reasonLabel).join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Source requests"
            subtitle="Every API request that makes up the dataset, with its outcome"
          >
            <div className="space-y-3">
              {q.sources.map((s) => (
                <details
                  key={s.dataset}
                  className="group rounded-md border border-line"
                  open={s.requests_failed > 0}
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-white">
                    <span>
                      <span className="text-sm font-semibold text-ink-900">{s.dataset}</span>
                      <span className="ml-2 text-xs text-ink-600">{s.description}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <Badge tone={s.requests_failed > 0 ? 'bad' : 'teal'}>
                        {s.requests_ok}/{s.requests_total} requests ok
                      </Badge>
                      <span className="tnum text-ink-600">{formatInt(s.raw_records)} records</span>
                      <ChevronDown
                        className="size-4 transition-transform group-open:rotate-180"
                        aria-hidden
                      />
                    </span>
                  </summary>
                  <div className="border-t border-line">
                    <p className="tnum px-3 py-2 text-xs text-ink-600">
                      Latest retrieval: {s.latest_retrieval ? formatInstant(s.latest_retrieval, tz) : 'never'}{' '}
                      · latest source publishTime:{' '}
                      {s.max_source_publish_time ? formatInstant(s.max_source_publish_time, tz) : MISSING}
                    </p>
                    <ChunkTable chunks={s.chunks} tz={tz} />
                  </div>
                </details>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

function ChunkTable({ chunks, tz }: { chunks: Chunk[]; tz: 'Europe/London' | 'UTC' }) {
  return (
    <div className="scroll-thin max-h-80 overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs">
        <caption className="sr-only">Source requests</caption>
        <thead className="sticky top-0 bg-canvas-sunken text-2xs uppercase tracking-[0.06em] text-ink-600">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Window
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Outcome
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Records
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Retrieved
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Attempts
            </th>
          </tr>
        </thead>
        <tbody>
          {chunks.map((c) => (
            <tr key={c.key} className="border-t border-line align-top">
              <td className="px-3 py-1.5 text-ink-700">{c.window}</td>
              <td className="px-3 py-1.5">
                <Badge tone={CHUNK_TONE[c.state]}>{CHUNK_LABEL[c.state]}</Badge>
                {c.error && <span className="mt-1 block font-mono text-2xs text-bad-700">{c.error}</span>}
              </td>
              <td className="tnum px-3 py-1.5 text-right">
                {c.record_count === null ? MISSING : formatInt(c.record_count)}
              </td>
              <td className="tnum px-3 py-1.5">
                {c.retrieved_at ? formatInstant(c.retrieved_at, tz) : MISSING}
              </td>
              <td className="tnum px-3 py-1.5 text-right">{c.attempts || MISSING}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AlignmentPanel({ q }: { q: Quality }) {
  const a = q.alignment
  const f = q.forecast
  const share = f.half_hourly_start_share
  const items: { label: string; n: number; help: string }[] = [
    {
      label: 'Actuals: records ignored as non-WIND',
      n: a.actual_non_wind_ignored,
      help: 'Only fuelType = WIND is used; other fuel types are discarded.',
    },
    {
      label: 'Actuals: records without a fuelType',
      n: a.actual_missing_fuel_type,
      help: 'Cannot be confirmed as WIND, so they are not used.',
    },
    {
      label: 'Actuals: malformed records',
      n: a.actual_malformed_records,
      help: 'Not an object, or startTime missing/unparseable.',
    },
    {
      label: 'Actuals: startTime not on a half-hour boundary',
      n: a.actual_misaligned_start,
      help: 'Cannot be matched to the half-hourly grid; dropped.',
    },
    {
      label: 'Actuals: settlementDate/period disagree with startTime',
      n: a.actual_settlement_mismatch,
      help: 'startTime (UTC) is treated as authoritative; mismatches are reported only.',
    },
    {
      label: 'Actuals: timestamps without an offset (assumed UTC)',
      n: a.actual_naive_timestamps,
      help: 'Elexon normally returns Z-suffixed UTC.',
    },
    {
      label: 'Actuals: records without publishTime',
      n: a.actual_missing_publish_time,
      help: 'Ranked lowest when choosing between duplicates.',
    },
    { label: 'Actuals: records outside the analysis period', n: a.actual_outside_period, help: 'Ignored.' },
    {
      label: 'Forecasts: malformed records',
      n: a.forecast_malformed_records,
      help: 'Not an object, or startTime missing/unparseable.',
    },
    {
      label: 'Forecasts: startTime not on a half-hour boundary',
      n: a.forecast_misaligned_start,
      help: 'Dropped: cannot be matched to the half-hourly grid.',
    },
    {
      label: 'Forecasts: records without publishTime',
      n: a.forecast_missing_publish_time,
      help: 'Dropped. Without a publishTime we cannot prove it was available at the cutoff, so it is never assumed to be.',
    },
    {
      label: 'Forecasts: timestamps without an offset (assumed UTC)',
      n: a.forecast_naive_timestamps,
      help: '',
    },
  ]
  return (
    <Panel
      title="Record and timestamp alignment"
      subtitle="Problems found while normalising source records to UTC half-hours"
    >
      <ul className="grid gap-x-8 gap-y-2.5 lg:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-start justify-between gap-4 text-sm">
            <span>
              <span className={i.n > 0 ? 'font-medium text-ink-900' : 'text-ink-700'}>{i.label}</span>
              {i.help && <span className="block text-xs text-ink-600">{i.help}</span>}
            </span>
            <span className={clsx('tnum font-semibold', i.n > 0 ? 'text-warn-700' : 'text-ink-500')}>
              {i.n === 0 ? 'none' : formatInt(i.n)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-md border border-line bg-canvas-sunken px-3 py-2.5 text-sm text-ink-700">
        <p className="font-medium text-ink-900">Forecast time resolution</p>
        {share === null ? (
          <p className="text-xs text-ink-600">No forecast records to inspect.</p>
        ) : (
          <>
            <p className="tnum text-xs">
              {formatPercent(share)} of WINDFOR startTimes fall on :00 or :30. Minute offsets seen:{' '}
              {Object.entries(f.start_minute_counts)
                .map(([m, n]) => `${m} (${formatInt(n)})`)
                .join(', ') || MISSING}
              .
            </p>
            <p className="mt-1 text-xs text-ink-600">
              Forecasts are matched on exact startTime. If WINDFOR does not publish a record for a half-hour
              (for example if it only covers whole hours), that half-hour is excluded as “No forecast record”:
              it is never interpolated or filled.
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}
