import clsx from 'clsx'
import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'

export function Panel({
  title,
  subtitle,
  info,
  actions,
  children,
  className,
  bodyClassName,
  id,
  headingLevel = 2,
}: {
  title?: string
  subtitle?: ReactNode
  /** Plain-English explanation shown in an InfoTip next to the title */
  info?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
  headingLevel?: 2 | 3
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id ?? title}-h` : undefined}
      className={clsx('panel animate-fade-in', className)}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-1.5">
                <H id={`${id ?? title}-h`} className="text-sm font-semibold text-ink-900">
                  {title}
                </H>
                {info && <InfoTip label={`About: ${title}`}>{info}</InfoTip>}
              </div>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-ink-600">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
