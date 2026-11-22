import BrandPanel from '../components/auth/BrandPanel.jsx'
import LoginForm from '../components/auth/LoginForm.jsx'
import Logo from '../components/auth/Logo.jsx'
import { Navigate, useNavigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth.js'

export default function LoginPage() {
  const { login, session, initializing, logoutReason } = useAuth()
  const navigate = useNavigate()
  const signIn = async (credentials) => {
    await login(credentials)
    navigate('/dashboard', { replace: true })
  }
  if (initializing)
    return (
      <main
        id="main-content"
        role="status"
        className="grid min-h-svh place-content-center text-sm text-muted"
      >
        Restoring your session…
      </main>
    )
  if (session) return <Navigate to="/dashboard" replace />
  return (
    <div className="flex min-h-svh bg-background">
      <BrandPanel />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full flex-col items-center justify-center gap-8 px-6 py-12 md:w-1/2 lg:px-12"
      >
        {/* Logo shown only when the brand panel is hidden (tablet / mobile) */}
        <Logo className="md:hidden" />
        {logoutReason && (
          <p
            role="status"
            className="w-full max-w-[420px] rounded-xl border border-line bg-white p-4 text-sm text-primary-dark"
          >
            {logoutReason === 'idle'
              ? 'You were signed out after 5 minutes of inactivity. Please sign in again.'
              : logoutReason === 'storage'
                ? 'Browser session storage is unavailable. Please sign in again.'
                : 'Your session could not be restored or has expired. Please sign in again.'}
          </p>
        )}
        <LoginForm onSubmit={signIn} />
      </main>
    </div>
  )
}
