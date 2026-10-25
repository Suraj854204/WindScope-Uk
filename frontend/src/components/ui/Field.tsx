import clsx from 'clsx'
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

const control =
  'h-9 w-full rounded border border-line-strong bg-white px-2.5 text-sm text-ink-900 placeholder:text-ink-500 transition-colors hover:border-ink-500 disabled:opacity-50 aria-[invalid=true]:border-bad-600'

function Wrapper({
  label,
  id,
  hint,
  error,
  children,
  className,
}: {
  label: string
  id: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="label-caps">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-bad-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-ink-600">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string
  wrapperClassName?: string
}

export function TextField({ label, hint, error, wrapperClassName, className, ...rest }: InputProps) {
  const id = useId()
  return (
    <Wrapper label={label} id={id} hint={hint} error={error} className={wrapperClassName}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={clsx(control, className)}
        {...rest}
      />
    </Wrapper>
  )
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hint?: string
  wrapperClassName?: string
  options: { value: string; label: string }[]
}

export function SelectField({ label, hint, wrapperClassName, options, className, ...rest }: SelectProps) {
  const id = useId()
  return (
    <Wrapper label={label} id={id} hint={hint} className={wrapperClassName}>
      <select id={id} className={clsx(control, 'pr-7', className)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  )
}
