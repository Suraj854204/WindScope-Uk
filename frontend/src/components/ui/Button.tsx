import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  /** Render on the dark navy chrome (header) */
  onDark?: boolean
}

const base =
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-[background-color,border-color,color,transform] duration-100 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0'

const variants: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-700 active:bg-navy-800',
  secondary: 'border border-line-strong bg-canvas-raised text-ink-800 hover:border-ink-500 hover:bg-white',
  ghost: 'text-ink-700 hover:bg-canvas-sunken',
  danger: 'border border-bad-600 bg-white text-bad-600 hover:bg-bad-50',
}
const darkVariants: Record<Variant, string> = {
  primary: 'bg-cyan-400 text-navy-950 hover:bg-cyan-300',
  secondary: 'border border-navy-500 bg-navy-800 text-navy-100 hover:border-navy-300 hover:bg-navy-700',
  ghost: 'text-navy-100 hover:bg-navy-700',
  danger: 'border border-bad-600 text-white hover:bg-bad-700',
}
const sizes: Record<Size, string> = { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm' }

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading,
    icon,
    onDark,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(base, sizes[size], onDark ? darkVariants[variant] : variants[variant], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})
