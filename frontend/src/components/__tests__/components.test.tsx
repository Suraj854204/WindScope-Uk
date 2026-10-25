import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FiltersProvider } from '@/state/filters'
import { CutoffControl } from '../layout/CutoffControl'
import { MetricCard } from '../MetricCard'
import { EmptyState, ErrorState } from '../ui/StateBlocks'

afterEach(() => vi.unstubAllGlobals())

describe('MetricCard', () => {
  it('shows the value and unit', () => {
    render(<MetricCard label="MAE" value="123.4" unit="MW" />)
    expect(screen.getByTestId('metric-MAE')).toHaveTextContent('123.4')
    expect(screen.getByTestId('metric-MAE')).toHaveTextContent('MW')
  })
  it('shows an explanatory note beside a missing value', () => {
    render(<MetricCard label="WAPE" value="—" note="Mean actual below threshold" />)
    expect(screen.getByTestId('metric-WAPE')).toHaveTextContent('—')
    expect(screen.getByText('Mean actual below threshold')).toBeInTheDocument()
  })
  it('hides content while loading', () => {
    render(<MetricCard label="Bias" value="5" loading />)
    expect(screen.queryByText('5')).not.toBeInTheDocument()
  })
})

describe('state blocks', () => {
  it('renders an empty state and an error state with retry', async () => {
    const retry = vi.fn()
    render(
      <>
        <EmptyState title="No matched intervals">Nothing to show</EmptyState>
        <ErrorState title="API unreachable" error={new Error('Check the backend')} onRetry={retry} />
      </>,
    )
    expect(screen.getByText('No matched intervals')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(retry).toHaveBeenCalledOnce()
  })
})

describe('CutoffControl', () => {
  function setup() {
    // config endpoint fails: the control must still work with built-in defaults
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <FiltersProvider>
            <CutoffControl />
          </FiltersProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('shows the default as an assumption and opens a dialog', async () => {
    setup()
    const trigger = await screen.findByRole(
      'button',
      { name: /decision cutoff: 09:00 on D-1/i },
      { timeout: 5000 },
    )
    expect(trigger).toHaveTextContent(/assumed/i)
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: /cutoff settings/i })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /decision cutoff/i }, { timeout: 5000 }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
