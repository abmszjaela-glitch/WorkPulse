import { useState } from 'react'
import { CircleAlert, Lock, Mail, ShieldAlert } from 'lucide-react'
import InputField from './InputField.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// onSubmit({ email, password, remember }) can be wired to the backend /auth/login later.
export default function LoginForm({ onSubmit }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    if (!EMAIL_PATTERN.test(email) || password.length === 0) {
      setError('Invalid email or password.')
      return
    }
    if (!onSubmit) {
      setError('Sign in is not available yet. Please contact your administrator.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await onSubmit({ email, password, remember })
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-[0_8px_30px_rgba(23,37,84,0.08)] sm:p-10">
      <h2 className="text-2xl font-bold tracking-tight text-primary-dark">Welcome back</h2>
      <p className="mt-1 text-sm text-primary-dark/60">Sign in to your WorkPulse account</p>

      <form onSubmit={handleSubmit} noValidate className="mt-7">
        <InputField
          id="email"
          label="Email address"
          type="email"
          icon={Mail}
          placeholder="name@company.com"
          autoComplete="email"
          value={email}
          error={Boolean(error)}
          onChange={(e) => setEmail(e.target.value)}
        />

        <InputField
          id="password"
          label="Password"
          type="password"
          icon={Lock}
          placeholder="Enter your password"
          autoComplete="current-password"
          className="mt-5"
          value={password}
          error={Boolean(error)}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p role="alert" className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-error">
            <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-primary-dark">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-primary-dark/30 text-primary focus:ring-primary"
            />
            Remember me
          </label>
          <button type="button" onClick={() => setRecoveryNotice((value) => !value)} className="cursor-pointer text-sm font-medium text-primary hover:underline">
            Forgot password?
          </button>
        </div>

        {recoveryNotice && <p role="status" className="mt-3 text-xs text-primary-dark/60">Contact your administrator to reset your password.</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 h-11 w-full cursor-pointer rounded-lg bg-primary text-sm font-semibold text-white transition hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 flex items-start gap-2.5 border-t border-background pt-5 text-xs leading-relaxed text-primary-dark/60">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p>Your activity data is monitored in line with company policy.</p>
      </div>
    </div>
  )
}
