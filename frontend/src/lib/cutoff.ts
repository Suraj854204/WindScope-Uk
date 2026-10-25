import type { AnalysisQuery } from '@/api/client'
import type { CutoffMode } from '@/api/types'

/** The user-editable decision cutoff. Mirrors the backend CutoffPolicy. */
export interface CutoffSettings {
  mode: CutoffMode
  /** HH:MM Europe/London (day_ahead mode) */
  time: string
  /** Days before the delivery date (day_ahead mode) */
  daysBefore: number
  /** Hours before interval start (lead_time mode) */
  leadHours: number
}

export const DEFAULT_CUTOFF: CutoffSettings = {
  mode: 'day_ahead',
  time: '09:00',
  daysBefore: 1,
  leadHours: 24,
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export interface CutoffErrors {
  time?: string
  daysBefore?: string
  leadHours?: string
}

export function validateCutoff(c: CutoffSettings): CutoffErrors {
  const errors: CutoffErrors = {}
  if (c.mode === 'day_ahead') {
    if (!HHMM.test(c.time)) errors.time = 'Enter a time as HH:MM (24-hour).'
    if (!Number.isInteger(c.daysBefore) || c.daysBefore < 0 || c.daysBefore > 14) {
      errors.daysBefore = 'Whole number of days between 0 and 14.'
    }
  } else if (!Number.isFinite(c.leadHours) || c.leadHours < 0 || c.leadHours > 336) {
    errors.leadHours = 'Hours between 0 and 336.'
  }
  return errors
}

export function cutoffToQuery(
  c: CutoffSettings,
): Pick<AnalysisQuery, 'cutoff_mode' | 'cutoff_time' | 'days_before' | 'lead_hours'> {
  return c.mode === 'lead_time'
    ? { cutoff_mode: 'lead_time', lead_hours: c.leadHours }
    : { cutoff_mode: 'day_ahead', cutoff_time: c.time, days_before: c.daysBefore }
}

/** Short label for the header: "09:00 on D-1" / "24 h before start". */
export function cutoffShortLabel(c: CutoffSettings): string {
  if (c.mode === 'lead_time') return `${c.leadHours} h before start`
  return `${c.time} ${c.daysBefore === 0 ? 'on D' : `on D-${c.daysBefore}`}`
}

export function cutoffEquals(a: CutoffSettings, b: CutoffSettings): boolean {
  return (
    a.mode === b.mode && a.time === b.time && a.daysBefore === b.daysBefore && a.leadHours === b.leadHours
  )
}
