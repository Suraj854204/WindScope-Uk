import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, CircleDashed, CloudOff, Loader2, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDatasetStatus } from '@/api/hooks'
import { formatInstant } from '@/lib/time'
import { useFilters } from '@/state/filters'

type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'busy'

const toneClass: Record<Tone, string> = {
  ok: 'text-teal-400',
  warn: 'text-warn-100',
  bad: 'text-red-300',
  idle: 'text-navy-300',
  busy: 'text-cyan-300',
}

/**
 * Data/API freshness derived ONLY from the real dataset-status endpoint: retrieval time is when this
 * app downloaded data, which is distinct from the source publishTime shown on the Data Quality page.
 */
export function FreshnessStatus() {
  const { tz } = useFilters()
  const { data, error, isPending } = useDatasetStatus()

  let tone: Tone = 'idle'
  let icon: ReactNode = <CircleDashed className="size-3.5" aria-hidden />
  let text = 'Checking data status…'
  let detail: string | undefined

  if (error && !data) {
    tone = 'bad'
    icon = <CloudOff className="size-3.5" aria-hidden />
    text = 'API unreachable'
    detail = 'The WindScope API did not respond.'
  } else if (data) {
    const when = data.retrieved_at_latest ? formatInstant(data.retrieved_at_latest, tz) : null
    switch (data.state) {
      case 'loading':
        tone = 'busy'
        icon = <Loader2 className="size-3.5 animate-spin" aria-hidden />
        text = `Downloading ${data.progress_completed}/${data.progress_total}`
        break
      case 'ready':
        if (data.stale) {
          tone = 'warn'
          icon = <AlertTriangle className="size-3.5" aria-hidden />
          text = `Stale · retrieved ${when ?? 'unknown'}`
        } else {
          tone = 'ok'
          icon = <CheckCircle2 className="size-3.5" aria-hidden />
          text = `Retrieved ${when ?? 'unknown'}`
        }
        break
      case 'partial':
        tone = 'warn'
        icon = <AlertTriangle className="size-3.5" aria-hidden />
        text = `Partial · ${data.chunks_usable}/${data.chunks_total} requests`
        break
      case 'failed':
        tone = 'bad'
        icon = <XCircle className="size-3.5" aria-hidden />
        text = 'Source unavailable'
        break
      case 'empty':
        text = 'No data downloaded'
        break
    }
    detail = data.message
    if (error) detail = `${data.message} (Latest status check failed.)`
  } else if (!isPending) {
    text = 'Status unknown'
  }

  return (
    <Link
      to="/quality"
      title={detail}
      aria-label={`Data status: ${text}. Open data quality`}
      className={clsx(
        'tnum inline-flex h-8 items-center gap-1.5 rounded border border-navy-600 bg-navy-800 px-2.5 text-xs font-medium transition-colors hover:border-navy-300 hover:bg-navy-700',
        toneClass[tone],
      )}
    >
      {icon}
      <span className="max-w-[16rem] truncate">{text}</span>
    </Link>
  )
}
