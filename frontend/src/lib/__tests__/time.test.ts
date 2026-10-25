import { describe, expect, it } from 'vitest'
import { addDays, dayTicks, formatClock, formatInstant, localDate, zoneAbbr } from '../time'

describe('time', () => {
  it('shows GMT in winter and BST in summer for London', () => {
    expect(zoneAbbr('2026-01-15T12:00:00Z', 'Europe/London')).toBe('GMT')
    expect(zoneAbbr('2026-07-15T12:00:00Z', 'Europe/London')).toBe('BST')
    expect(zoneAbbr('2026-07-15T12:00:00Z', 'UTC')).toBe('UTC')
  })
  it('converts an instant across the spring-forward boundary', () => {
    // 2026-03-29 01:00 UTC is the first instant of BST: 02:00 London local
    expect(formatClock('2026-03-29T00:59:00Z', 'Europe/London')).toBe('00:59')
    expect(formatClock('2026-03-29T01:00:00Z', 'Europe/London')).toBe('02:00')
    expect(formatClock('2026-03-29T01:00:00Z', 'UTC')).toBe('01:00')
  })
  it('formats instants and tolerates bad input', () => {
    expect(formatInstant('2026-01-01T09:00:00Z', 'UTC')).toContain('09:00')
    expect(formatInstant(null, 'UTC')).toBe('—')
    expect(formatInstant('not a date', 'UTC')).toBe('—')
  })
  it('does calendar arithmetic without timezone drift', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
  })
  it('uses the local date for day grouping', () => {
    const t = Date.parse('2026-07-01T23:30:00Z') // 00:30 on 2 Jul in London (BST)
    expect(localDate(t, 'Europe/London')).toBe('2026-07-02')
    expect(localDate(t, 'UTC')).toBe('2026-07-01')
  })
  it('places one tick per local day, thinned to maxTicks', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    const times = Array.from({ length: 48 * 10 }, (_, i) => start + i * 30 * 60_000)
    expect(dayTicks(times, 'UTC', 100)).toHaveLength(10)
    expect(dayTicks(times, 'UTC', 5).length).toBeLessThanOrEqual(5)
    expect(dayTicks([], 'UTC')).toEqual([])
  })
})
