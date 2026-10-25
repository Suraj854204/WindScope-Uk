import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FiltersProvider, useFilters } from '../filters'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  // config call fails -> built-in fallback period 2026-01-01..2026-01-31
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <FiltersProvider>{children}</FiltersProvider>
    </QueryClientProvider>
  )
  return renderHook(() => useFilters(), { wrapper })
}

describe('setDateRange', () => {
  it('ignores partial / out-of-period dates produced while typing a year', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 5000 })
    const before = { from: result.current.dateFrom, to: result.current.dateTo }
    act(() => result.current.setDateRange('0002-01-05', before.to))
    act(() => result.current.setDateRange(before.from, '2027-01-01'))
    expect(result.current.dateFrom).toBe(before.from)
    expect(result.current.dateTo).toBe(before.to)
  })
  it('accepts a valid range inside the period', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 5000 })
    act(() => result.current.setDateRange('2026-01-05', '2026-01-10'))
    expect(result.current.dateFrom).toBe('2026-01-05')
    expect(result.current.dateTo).toBe('2026-01-10')
  })
})
