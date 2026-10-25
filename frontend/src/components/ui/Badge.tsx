import clsx from 'clsx'
import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'cyan' | 'teal' | 'warn' | 'bad' | 'navy'

const tones: Record<Tone, string> = {
  neutral: 'bg-canvas-sunken text-ink-700 border-line',
  cyan: 'bg-cyan-400/10 text-cyan-700 border-cyan-600/30',
  teal: 'bg-teal-500/10 text-teal-700 border-teal-700/30',
  warn: 'bg-warn-50 text-warn-700 border-warn-600/40',
  bad: 'bg-bad-50 text-bad-700 border-bad-600/40',
  navy: 'bg-navy-900 text-navy-100 border-navy-700',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px text-2xs font-medium leading-4',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
