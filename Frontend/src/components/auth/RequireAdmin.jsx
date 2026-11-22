import { Navigate, Outlet } from 'react-router-dom'
import useAuth from '../../hooks/useAuth.js'

export default function RequireAdmin() {
  const { session, initializing } = useAuth()
  if (initializing)
    return (
      <div
        role="status"
        className="grid min-h-svh place-content-center text-sm text-muted"
      >
        Restoring your session…
      </div>
    )
  return session?.user.role === 'A' ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace />
  )
}
