import { describe, expect, it } from 'vitest'
import { excludedRuns } from '../charts/ForecastChart'

const rows = (s: string) => [...s].map((c) => ({ matched: c === 'm' }))

describe('excludedRuns', () => {
  it('finds contiguous unmatched runs', () => {
    expect(excludedRuns(rows('mmxxmxm'))).toEqual([
      [2, 3],
      [5, 5],
    ])
  })
  it('closes a run that reaches the end and handles edge cases', () => {
    expect(excludedRuns(rows('mxx'))).toEqual([[1, 2]])
    expect(excludedRuns(rows('xxx'))).toEqual([[0, 2]])
    expect(excludedRuns(rows('mmm'))).toEqual([])
    expect(excludedRuns([])).toEqual([])
  })
})
