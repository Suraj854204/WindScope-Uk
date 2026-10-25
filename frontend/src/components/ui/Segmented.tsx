import clsx from 'clsx'
import { useId } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

/** Radio-group segmented control (arrow-key navigation comes from native radios). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  onDark,
  size = 'md',
}: {
  label: string
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  onDark?: boolean
  size?: 'sm' | 'md'
}) {
  const name = useId()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'inline-flex rounded border p-0.5',
        onDark ? 'border-navy-600 bg-navy-800' : 'border-line-strong bg-canvas-sunken',
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <label
            key={o.value}
            className={clsx(
              'relative cursor-pointer select-none rounded-[3px] font-medium transition-colors duration-100 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-cyan-600',
              size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1 text-xs',
              active
                ? onDark
                  ? 'bg-cyan-400 text-navy-950'
                  : 'bg-navy-900 text-white'
                : onDark
                  ? 'text-navy-200 hover:text-white'
                  : 'text-ink-600 hover:text-ink-900',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              onChange={() => onChange(o.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            {o.label}
          </label>
        )
      })}
    </div>
  )
}
