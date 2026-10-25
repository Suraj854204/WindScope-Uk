import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AnalysisQuery } from '@/api/client'
import { useConfig } from '@/api/hooks'
import { cutoffToQuery, validateCutoff, DEFAULT_CUTOFF, type CutoffSettings } from '@/lib/cutoff'
import type { TimeZoneMode } from '@/lib/time'

export const FALLBACK_PERIOD = { from: '2026-01-01', to: '2026-01-31' }
const STORAGE_KEY = 'windscope.filters.v1'
const YMD = /^\d{4}-\d{2}-\d{2}$/

interface Persisted {
  dateFrom: string
  dateTo: string
  cutoff: CutoffSettings
  tz: TimeZoneMode
}

export interface FiltersValue extends Persisted {
  bounds: { min: string; max: string }
  /** Server default cutoff (what "Reset" restores). */
  defaultCutoff: CutoffSettings
  analysisQuery: AnalysisQuery
  setDateRange: (from: string, to: string) => void
  setCutoff: (c: CutoffSettings) => void
  setTz: (tz: TimeZoneMode) => void
  resetCutoff: () => void
}

const Ctx = createContext<FiltersValue | null>(null)

function load(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Persisted>
    if (!p.dateFrom || !p.dateTo || !YMD.test(p.dateFrom) || !YMD.test(p.dateTo) || !p.cutoff) return null
    if (Object.keys(validateCutoff(p.cutoff)).length > 0) return null
    return {
      dateFrom: p.dateFrom,
      dateTo: p.dateTo,
      cutoff: p.cutoff,
      tz: p.tz === 'UTC' ? 'UTC' : 'Europe/London',
    }
  } catch {
    return null // storage unavailable or corrupt: fall back to defaults
  }
}

function save(p: Persisted) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable (private mode): filters simply won't persist */
  }
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const { data: config, isPending: configPending } = useConfig()
  const bounds = useMemo(
    () => ({
      min: config?.period.date_from ?? FALLBACK_PERIOD.from,
      max: config?.period.date_to ?? FALLBACK_PERIOD.to,
    }),
    [config],
  )
  const defaultCutoff = useMemo<CutoffSettings>(() => {
    const d = config?.default_cutoff
    if (!d) return DEFAULT_CUTOFF
    return {
      mode: d.mode,
      time: d.cutoff_time ?? DEFAULT_CUTOFF.time,
      daysBefore: d.days_before ?? DEFAULT_CUTOFF.daysBefore,
      leadHours: d.lead_hours ?? DEFAULT_CUTOFF.leadHours,
    }
  }, [config])

  const [state, setState] = useState<Persisted>(
    () =>
      load() ?? {
        dateFrom: FALLBACK_PERIOD.from,
        dateTo: FALLBACK_PERIOD.to,
        cutoff: DEFAULT_CUTOFF,
        tz: 'Europe/London',
      },
  )

  // Keep the selected range inside the server-defined analysis period.
  useEffect(() => {
    setState((s) => {
      const from = s.dateFrom < bounds.min || s.dateFrom > bounds.max ? bounds.min : s.dateFrom
      const to = s.dateTo > bounds.max || s.dateTo < bounds.min ? bounds.max : s.dateTo
      return from === s.dateFrom && to === s.dateTo
        ? s
        : { ...s, dateFrom: from, dateTo: from > to ? from : to }
    })
  }, [bounds])

  useEffect(() => save(state), [state])

  const setDateRange = useCallback(
    (from: string, to: string) => {
      if (!YMD.test(from) || !YMD.test(to)) return
      // Typing a year into a date input emits partial values such as 0002-01-05; ignore anything
      // outside the analysis period instead of sending it to the API.
      if (from < bounds.min || to > bounds.max || from > bounds.max || to < bounds.min) return
      setState((s) => ({ ...s, dateFrom: from <= to ? from : to, dateTo: from <= to ? to : from }))
    },
    [bounds],
  )
  const setCutoff = useCallback((cutoff: CutoffSettings) => setState((s) => ({ ...s, cutoff })), [])
  const setTz = useCallback((tz: TimeZoneMode) => setState((s) => ({ ...s, tz })), [])
  const resetCutoff = useCallback(() => setState((s) => ({ ...s, cutoff: defaultCutoff })), [defaultCutoff])

  const analysisQuery = useMemo<AnalysisQuery>(
    () => ({ date_from: state.dateFrom, date_to: state.dateTo, ...cutoffToQuery(state.cutoff) }),
    [state.dateFrom, state.dateTo, state.cutoff],
  )

  const value = useMemo<FiltersValue>(
    () => ({ ...state, bounds, defaultCutoff, analysisQuery, setDateRange, setCutoff, setTz, resetCutoff }),
    [state, bounds, defaultCutoff, analysisQuery, setDateRange, setCutoff, setTz, resetCutoff],
  )
  // Hold the UI until the server-defined period is known (or the config call failed), so no query is
  // issued with a guessed date range.
  if (configPending) {
    return (
      <div role="status" className="grid min-h-screen place-items-center text-sm text-ink-600">
        Connecting to the WindScope API…
      </div>
    )
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFilters(): FiltersValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFilters must be used inside <FiltersProvider>')
  return v
}
