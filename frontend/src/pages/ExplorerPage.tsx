import { ChevronLeft, ChevronRight, Download, RotateCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type IntervalsQuery } from '@/api/client'
import { useIntervals } from '@/api/hooks'
import type { SortKey } from '@/api/types'
import { DateRangeControl } from '@/components/DateRangeControl'
import { IntervalDetailDrawer } from '@/components/IntervalDetailDrawer'
import { IntervalsTable } from '@/components/IntervalsTable'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { PageHeader, Panel } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/StateBlocks'
import { WarningList } from '@/components/WarningList'
import { saveBlob } from '@/lib/download'
import { formatInt } from '@/lib/format'
import { ALL_REASONS, REASON_LABEL } from '@/lib/reasons'
import { useFilters } from '@/state/filters'

const SORT_KEYS: SortKey[] = [
  'start_time',
  'actual_mw',
  'forecast_mw',
  'signed_error_mw',
  'abs_error_mw',
  'forecast_publish_time',
]
const PAGE_SIZES = [25, 50, 100, 200]
const DIRECTIONS = ['all', 'over', 'under', 'exact'] as const

function intParam(v: string | null, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function ExplorerPage() {
  const { analysisQuery, tz } = useFilters()
  const [sp, setSp] = useSearchParams()

  // Table state lives in the URL so views are shareable and survive navigation.
  const page = intParam(sp.get('page'), 1)
  const rawSize = intParam(sp.get('size'), 50)
  const size = PAGE_SIZES.includes(rawSize) ? rawSize : 50
  const sortBy = (SORT_KEYS as string[]).includes(sp.get('sort') ?? '')
    ? (sp.get('sort') as SortKey)
    : 'start_time'
  const sortDir = sp.get('dir') === 'desc' ? 'desc' : 'asc'
  const q = sp.get('q') ?? ''
  const status = sp.get('status') ?? 'all'
  const rawDir = sp.get('direction') ?? 'all'
  const direction = (DIRECTIONS as readonly string[]).includes(rawDir)
    ? (rawDir as (typeof DIRECTIONS)[number])
    : 'all'

  const update = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '' || v === 'all') next.delete(k)
            else next.set(k, String(v))
          }
          if (resetPage && !('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setSp],
  )

  // Debounced search box -> URL
  const [searchText, setSearchText] = useState(q)
  useEffect(() => setSearchText(q), [q])
  useEffect(() => {
    if (searchText === q) return
    const t = setTimeout(() => update({ q: searchText.trim() }), 300)
    return () => clearTimeout(t)
  }, [searchText, q, update])

  const query = useMemo<IntervalsQuery>(
    () => ({
      ...analysisQuery,
      page,
      page_size: size,
      sort_by: sortBy,
      sort_dir: sortDir,
      status,
      direction,
      q,
    }),
    [analysisQuery, page, size, sortBy, sortDir, status, direction, q],
  )
  const intervals = useIntervals(query)
  const data = intervals.data

  const [inspect, setInspect] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const exportCsv = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const { blob, filename } = await api.intervalsCsv(query)
      saveBlob(blob, filename)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const filtersActive = q !== '' || status !== 'all' || direction !== 'all'
  // Same column toggles direction; a new column starts ascending.
  const onSort = (by: SortKey) =>
    update({ sort: by, dir: sortBy === by ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc' })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Forecast Explorer"
        description="Every half-hour in the selected dates with its actual, the forecast that was available at the cutoff, and the error. Excluded intervals stay visible with the reason they were left out of the metrics."
        actions={
          <Button
            variant="primary"
            onClick={exportCsv}
            loading={exporting}
            disabled={!data || data.total === 0}
            icon={<Download className="size-4" aria-hidden />}
          >
            Export CSV
          </Button>
        }
      />
      {exportError && (
        <WarningList
          warnings={[
            { code: 'export_failed', severity: 'error', message: `CSV export failed: ${exportError}` },
          ]}
        />
      )}

      <Panel
        title="Filters"
        subtitle="Date range applies across the whole app. The CSV contains exactly the rows matching these filters (all pages)."
      >
        <div className="space-y-4">
          <DateRangeControl />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
            <TextField
              label="Search"
              type="search"
              placeholder="e.g. 2026-01-14 09:30 or p19"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              hint="Matches UTC/London time, settlement date or period (all words must match)."
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(e) => update({ status: e.target.value })}
              options={[
                { value: 'all', label: 'All intervals' },
                { value: 'matched', label: 'Matched only' },
                { value: 'excluded', label: 'Excluded only' },
                ...ALL_REASONS.map((r) => ({ value: r, label: `Excluded: ${REASON_LABEL[r]}` })),
              ]}
            />
            <SelectField
              label="Error direction"
              value={direction}
              onChange={(e) => update({ direction: e.target.value })}
              options={[
                { value: 'all', label: 'Any' },
                { value: 'over', label: 'Over-forecast (error > 0)' },
                { value: 'under', label: 'Under-forecast (error < 0)' },
                { value: 'exact', label: 'Exact (error = 0)' },
              ]}
            />
            <SelectField
              label="Rows per page"
              value={String(size)}
              onChange={(e) => update({ size: e.target.value })}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <div className="flex items-end">
              <Button
                onClick={() => {
                  setSearchText('')
                  update({ q: null, status: null, direction: null, sort: null, dir: null, size: null })
                }}
                disabled={!filtersActive && sortBy === 'start_time' && sortDir === 'asc' && size === 50}
                icon={<RotateCcw className="size-3.5" aria-hidden />}
                className="h-9"
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Intervals"
        bodyClassName="p-0"
        subtitle={
          data
            ? `${formatInt(data.total)} intervals in filter · ${formatInt(data.matched_in_filter)} matched · ${formatInt(data.excluded_in_filter)} excluded · cutoff ${data.cutoff.description}`
            : 'Loading intervals…'
        }
      >
        {intervals.isPending ? (
          <TableSkeleton rows={10} cols={8} />
        ) : intervals.isError && !data ? (
          <ErrorState
            error={intervals.error}
            onRetry={() => void intervals.refetch()}
            retrying={intervals.isFetching}
          />
        ) : data ? (
          <>
            <div
              aria-busy={intervals.isFetching}
              className={intervals.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}
            >
              <IntervalsTable
                items={data.items}
                tz={tz}
                sort={{ by: sortBy, dir: sortDir }}
                onSort={onSort}
                onInspect={setInspect}
                caption={`Half-hourly wind generation intervals, page ${data.page} of ${data.total_pages}`}
                emptyMessage={
                  data.total === 0 && !filtersActive
                    ? 'There are no intervals for the selected dates.'
                    : 'No intervals match these filters. Try resetting them.'
                }
              />
            </div>
            <nav
              aria-label="Pagination"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3"
            >
              <p className="tnum text-xs text-ink-600" aria-live="polite">
                {data.total === 0
                  ? 'No rows'
                  : `Rows ${formatInt((data.page - 1) * data.page_size + 1)}–${formatInt(Math.min(data.page * data.page_size, data.total))} of ${formatInt(data.total)}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => update({ page: data.page - 1 }, false)}
                  disabled={data.page <= 1}
                  icon={<ChevronLeft className="size-3.5" aria-hidden />}
                >
                  Previous
                </Button>
                <span className="tnum text-xs text-ink-700">
                  Page {formatInt(data.page)} of {formatInt(data.total_pages)}
                </span>
                <Button
                  size="sm"
                  onClick={() => update({ page: data.page + 1 }, false)}
                  disabled={data.page >= data.total_pages}
                >
                  Next
                  <ChevronRight className="size-3.5" aria-hidden />
                </Button>
              </div>
            </nav>
          </>
        ) : null}
      </Panel>

      <p className="flex items-center gap-1.5 text-xs text-ink-600">
        <Search className="size-3.5" aria-hidden />
        Times are shown in {tz === 'UTC' ? 'UTC' : 'Europe/London (GMT/BST)'}; hover a time to see the UTC
        instant. A dash means the value is missing, never zero.
      </p>

      <IntervalDetailDrawer start={inspect} onClose={() => setInspect(null)} />
    </div>
  )
}
