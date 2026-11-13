import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function InputField({
  id,
  label,
  icon: Icon,
  type = 'text',
  error = false,
  className = '',
  ...props
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-primary-dark">
        {label}
      </label>
      <div
        className={`flex h-11 items-center gap-3 rounded-lg border bg-slate-50/50 px-3.5 transition focus-within:border-primary/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-primary/10 ${
          error ? 'border-error/60' : 'border-line'
        }`}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0 text-primary-dark/50" aria-hidden="true" />}
        <input
          id={id}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error}
          className="min-w-0 flex-1 bg-transparent text-sm text-primary-dark outline-none placeholder:text-primary-dark/40"
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="shrink-0 rounded text-primary-dark/50 transition hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  )
}
