import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { ChartSkeleton } from '@/components/ui/Skeleton'
import { FiltersProvider } from '@/state/filters'
import { AccuracyPage } from '@/pages/AccuracyPage'
import { ExplorerPage } from '@/pages/ExplorerPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { QualityPage } from '@/pages/QualityPage'
import { useDatasetStatus } from '@/api/hooks'

const MethodologyPage = lazy(() =>
  import('@/pages/MethodologyPage').then((m) => ({ default: m.MethodologyPage })),
)

/** Last line of defence: an unexpected render error shows a recoverable message instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        className="mx-auto mt-16 max-w-md space-y-3 rounded-md border border-bad-600/40 bg-bad-50 p-6 text-center"
      >
        <h1 className="text-base font-semibold text-ink-900">Something went wrong displaying this page</h1>
        <p className="text-sm text-ink-700">{this.state.error.message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}

/** Mounted once so dataset status is polled and analysis queries refresh when a download completes. */
function DatasetWatcher() {
  useDatasetStatus()
  return null
}

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="explorer" element={<ExplorerPage />} />
        <Route path="accuracy" element={<AccuracyPage />} />
        <Route path="quality" element={<QualityPage />} />
        <Route
          path="methodology"
          element={
            <Suspense fallback={<ChartSkeleton height={240} label="Loading methodology" />}>
              <MethodologyPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-semibold text-ink-900">Page not found</h1>
      <p className="mt-1 text-sm text-ink-600">Use the navigation to return to the Overview.</p>
    </div>
  )
}

export default function App() {
  const client = createQueryClient()
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <FiltersProvider>
          <DatasetWatcher />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </FiltersProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
