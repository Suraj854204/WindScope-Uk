import { describe, expect, it } from 'vitest'
import { MISSING, biasDirection, formatInt, formatMw, formatPercent, formatSignedMw, plural } from '../format'

describe('format', () => {
  it('renders null/undefined/NaN as an em dash, never zero', () => {
    for (const fn of [formatInt, formatMw, formatSignedMw, formatPercent]) {
      expect(fn(null)).toBe(MISSING)
      expect(fn(undefined)).toBe(MISSING)
      expect(fn(Number.NaN)).toBe(MISSING)
    }
  })
  it('keeps a genuine zero as zero', () => {
    expect(formatMw(0)).toBe('0.0')
    expect(formatInt(0)).toBe('0')
  })
  it('signs errors with + and a true minus', () => {
    expect(formatSignedMw(12.5)).toBe('+12.5')
    expect(formatSignedMw(-7)).toBe('−7.0')
    expect(formatSignedMw(0)).toBe('0.0')
  })
  it('groups thousands', () => {
    expect(formatMw(12345.67)).toBe('12,345.7')
  })
  it('formats ratios as percentages', () => {
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatPercent(0.5, 0)).toBe('50%')
  })
  it('derives bias direction from the sign (forecast minus actual)', () => {
    expect(biasDirection(5)).toBe('over-forecast')
    expect(biasDirection(-5)).toBe('under-forecast')
    expect(biasDirection(0)).toBe('no net bias')
    expect(biasDirection(null)).toBeNull()
  })
  it('pluralises', () => {
    expect(plural(1, 'interval')).toBe('1 interval')
    expect(plural(1488, 'interval')).toBe('1,488 intervals')
  })
})
