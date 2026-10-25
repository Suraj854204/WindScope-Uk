import clsx from 'clsx'

/** Tasteful placeholder block; motion is disabled by the global reduced-motion rule. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse2 rounded bg-canvas-sunken', className)} />
}

export function ChartSkeleton({
  height = 280,
  label = 'Loading chart',
}: {
  height?: number
  label?: string
}) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3" style={{ height }}>
      <div className="flex flex-1 items-end gap-1.5 px-2">
        {Array.from({ length: 28 }, (_, i) => (
          <Skeleton key={i} className="flex-1" />
        ))}
      </div>
      <Skeleton className="h-3 w-full" />
      <span className="sr-only">{label}…</span>
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div role="status" aria-label="Loading metric" className="space-y-3">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading table" className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}
