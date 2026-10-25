import { describe, expect, it } from 'vitest'
import { DEFAULT_CUTOFF, cutoffEquals, cutoffShortLabel, cutoffToQuery, validateCutoff } from '../cutoff'

describe('cutoff', () => {
  it('defaults to 09:00 on D-1', () => {
    expect(DEFAULT_CUTOFF).toMatchObject({ mode: 'day_ahead', time: '09:00', daysBefore: 1 })
    expect(cutoffShortLabel(DEFAULT_CUTOFF)).toBe('09:00 on D-1')
  })
  it('accepts valid and rejects invalid day-ahead values', () => {
    expect(validateCutoff(DEFAULT_CUTOFF)).toEqual({})
    expect(validateCutoff({ ...DEFAULT_CUTOFF, time: '24:00' }).time).toBeDefined()
    expect(validateCutoff({ ...DEFAULT_CUTOFF, time: '9:00' }).time).toBeDefined()
    expect(validateCutoff({ ...DEFAULT_CUTOFF, daysBefore: -1 }).daysBefore).toBeDefined()
    expect(validateCutoff({ ...DEFAULT_CUTOFF, daysBefore: 1.5 }).daysBefore).toBeDefined()
    expect(validateCutoff({ ...DEFAULT_CUTOFF, daysBefore: 15 }).daysBefore).toBeDefined()
  })
  it('validates lead-time mode independently', () => {
    const lead = { ...DEFAULT_CUTOFF, mode: 'lead_time' as const, time: 'garbage' }
    expect(validateCutoff(lead)).toEqual({})
    expect(validateCutoff({ ...lead, leadHours: -1 }).leadHours).toBeDefined()
    expect(validateCutoff({ ...lead, leadHours: Number.NaN }).leadHours).toBeDefined()
  })
  it('builds the right query for each mode', () => {
    expect(cutoffToQuery(DEFAULT_CUTOFF)).toEqual({
      cutoff_mode: 'day_ahead',
      cutoff_time: '09:00',
      days_before: 1,
    })
    expect(cutoffToQuery({ ...DEFAULT_CUTOFF, mode: 'lead_time', leadHours: 12 })).toEqual({
      cutoff_mode: 'lead_time',
      lead_hours: 12,
    })
  })
  it('compares settings', () => {
    expect(cutoffEquals(DEFAULT_CUTOFF, { ...DEFAULT_CUTOFF })).toBe(true)
    expect(cutoffEquals(DEFAULT_CUTOFF, { ...DEFAULT_CUTOFF, time: '10:00' })).toBe(false)
  })
})
