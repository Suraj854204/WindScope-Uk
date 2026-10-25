import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'
import type { Severity, Warning } from '@/api/types'

const styles: Record<Severity, { box: string; icon: typeof Info; label: string }> = {
  info: { box: 'border-line bg-canvas-raised text-ink-700', icon: Info, label: 'Note' },
  warning: { box: 'border-warn-600/40 bg-warn-50 text-warn-700', icon: AlertTriangle, label: 'Warning' },
  error: { box: 'border-bad-600/40 bg-bad-50 text-bad-700', icon: AlertOctagon, label: 'Error' },
}

/** Server-generated warnings, most severe first. Errors/warnings use role=alert, notes role=status. */
export function WarningList({ warnings, className }: { warnings: Warning[]; className?: string }) {
  if (warnings.length === 0) return null
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  const sorted = [...warnings].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <ul className={clsx('space-y-2', className)} aria-label="Data and analysis notices">
      {sorted.map((w) => {
        const s = styles[w.severity]
        const Icon = s.icon
        return (
          <li
            key={w.code}
            role={w.severity === 'info' ? 'status' : 'alert'}
            className={clsx('flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm', s.box)}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="sr-only">{s.label}: </span>
              {w.message}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
