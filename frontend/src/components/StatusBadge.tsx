import { CheckCircle2, MinusCircle } from 'lucide-react'
import type { Interval } from '@/api/types'
import { REASON_LABEL } from '@/lib/reasons'
import { Badge } from './ui/Badge'

export function StatusBadge({ status }: { status: Interval['status'] }) {
  return status === 'matched' ? (
    <Badge tone="teal">
      <CheckCircle2 className="size-3" aria-hidden />
      Matched
    </Badge>
  ) : (
    <Badge tone="warn">
      <MinusCircle className="size-3" aria-hidden />
      Excluded
    </Badge>
  )
}

export function ReasonList({ reasons }: { reasons: Interval['reasons'] }) {
  if (reasons.length === 0) return null
  return (
    <ul className="mt-0.5 space-y-0.5 text-2xs text-warn-700">
      {reasons.map((r) => (
        <li key={r}>{REASON_LABEL[r] ?? r}</li>
      ))}
    </ul>
  )
}
