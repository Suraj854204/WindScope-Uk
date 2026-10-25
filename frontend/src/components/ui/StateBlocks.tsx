import clsx from 'clsx'
import { AlertTriangle, CloudOff, Inbox, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { Button } from './Button'

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}
    >
      <Inbox className="size-6 text-ink-500" aria-hidden />
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-600">{children}</div>}
      {action}
    </div>
  )
}

/** Error block with retry. Distinguishes "API unreachable" from "API returned an error". */
export function ErrorState({
  error,
  onRetry,
  retrying,
  title,
  className,
}: {
  error: unknown
  onRetry?: () => void
  retrying?: boolean
  title?: string
  className?: string
}) {
  const api = error instanceof ApiError ? error : null
  const unreachable = api?.isNetwork ?? false
  const message = api?.message ?? (error instanceof Error ? error.message : 'Something went wrong.')
  const Icon = unreachable ? CloudOff : AlertTriangle
  return (
    <div
      role="alert"
      className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}
    >
      <Icon className="size-6 text-bad-600" aria-hidden />
      <p className="text-sm font-semibold text-ink-900">
        {title ?? (unreachable ? 'The WindScope API is unreachable' : 'This view could not be loaded')}
      </p>
      <p className="max-w-md text-sm text-ink-600">{message}</p>
      {api?.code && !unreachable && <p className="font-mono text-2xs text-ink-500">code: {api.code}</p>}
      {onRetry && (
        <Button
          size="sm"
          onClick={onRetry}
          loading={retrying}
          icon={<RefreshCw className="size-3.5" aria-hidden />}
        >
          Retry
        </Button>
      )}
    </div>
  )
}
