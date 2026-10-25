import clsx from 'clsx'
import { Info } from 'lucide-react'
import { useId, type ReactNode } from 'react'

/**
 * Keyboard- and hover-accessible explanation popover. The trigger is a real button, the content
 * is exposed through aria-describedby and appears on hover or focus.
 */
export function InfoTip({
  label,
  children,
  align = 'left',
  className,
}: {
  label: string
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  const id = useId()
  return (
    <span className={clsx('group relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex size-4 items-center justify-center rounded-full text-ink-500 transition-colors hover:text-cyan-700"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={clsx(
          'pointer-events-none invisible absolute top-full z-40 mt-1.5 w-64 rounded-md bg-navy-900 p-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-navy-100 opacity-0 shadow-pop transition-opacity duration-100 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
          align === 'left' && 'left-0',
          align === 'right' && 'right-0',
          align === 'center' && 'left-1/2 -translate-x-1/2',
        )}
      >
        {children}
      </span>
    </span>
  )
}
