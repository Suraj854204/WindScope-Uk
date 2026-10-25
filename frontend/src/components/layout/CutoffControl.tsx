import clsx from 'clsx'
import { Clock, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cutoffEquals, cutoffShortLabel, validateCutoff, type CutoffSettings } from '@/lib/cutoff'
import { useFilters } from '@/state/filters'
import { Button } from '../ui/Button'
import { TextField } from '../ui/Field'
import { Segmented } from '../ui/Segmented'

/** Header control for the purchase-decision cutoff - the single most important assumption. */
export function CutoffControl() {
  const { cutoff, setCutoff, resetCutoff, defaultCutoff } = useFilters()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CutoffSettings>(cutoff)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const errors = validateCutoff(draft)
  const valid = Object.keys(errors).length === 0
  const isDefault = cutoffEquals(cutoff, defaultCutoff)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    popRef.current?.querySelector<HTMLElement>('input')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const toggle = () => {
    if (!open) setDraft(cutoff)
    setOpen((o) => !o)
  }
  const apply = () => {
    if (!valid) return
    setCutoff(draft)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        onDark
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Decision cutoff: ${cutoffShortLabel(cutoff)}${isDefault ? ' (default assumption)' : ''}. Edit`}
        onClick={toggle}
        icon={<Clock className="size-3.5 text-cyan-400" aria-hidden />}
      >
        <span className="text-navy-300">Cutoff</span>
        <span className="tnum">{cutoffShortLabel(cutoff)}</span>
        {isDefault && <span className="text-2xs font-normal text-warn-100">assumed</span>}
        <ChevronDown className={clsx('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Decision cutoff settings"
          className="fixed inset-x-3 top-[4.5rem] z-50 animate-fade-in rounded-md border border-line bg-canvas-raised p-4 text-ink-800 shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              apply()
            }}
            className="space-y-3"
          >
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Purchase decision cutoff</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                For each delivery half-hour the app uses the latest WINDFOR forecast whose publishTime is at
                or before this cutoff. Forecasts published later are never used.
              </p>
            </div>

            <Segmented
              label="Cutoff mode"
              size="sm"
              value={draft.mode}
              onChange={(mode) => setDraft({ ...draft, mode })}
              options={[
                { value: 'day_ahead', label: 'Day-ahead clock time' },
                { value: 'lead_time', label: 'Fixed lead time' },
              ]}
            />

            {draft.mode === 'day_ahead' ? (
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Time (Europe/London)"
                  type="time"
                  step={60}
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                  error={errors.time}
                />
                <TextField
                  label="Days before delivery"
                  type="number"
                  min={0}
                  max={14}
                  step={1}
                  value={Number.isNaN(draft.daysBefore) ? '' : draft.daysBefore}
                  onChange={(e) =>
                    setDraft({ ...draft, daysBefore: e.target.value === '' ? NaN : Number(e.target.value) })
                  }
                  error={errors.daysBefore}
                  hint="1 = day before (D-1)"
                />
              </div>
            ) : (
              <TextField
                label="Hours before interval start"
                type="number"
                min={0}
                max={336}
                step={0.5}
                value={Number.isNaN(draft.leadHours) ? '' : draft.leadHours}
                onChange={(e) =>
                  setDraft({ ...draft, leadHours: e.target.value === '' ? NaN : Number(e.target.value) })
                }
                error={errors.leadHours}
              />
            )}

            <p className="rounded border border-warn-600/30 bg-warn-50 px-2.5 py-2 text-xs leading-relaxed text-warn-700">
              The client has not specified an exact decision cutoff. The default, 09:00 Europe/London on the
              day before delivery, is an assumption for a day-ahead process. Confirm it with your trading
              desk.
            </p>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetCutoff()
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                disabled={isDefault}
              >
                Reset to default
              </Button>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" type="submit" disabled={!valid}>
                  Apply
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
