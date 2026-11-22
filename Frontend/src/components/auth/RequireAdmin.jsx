import { Navigate, Outlet } from 'react-router-dom'
import useAuth from '../../hooks/useAuth.js'

export default function RequireAdmin() {
  const { session } = useAuth()
  return session?.user.role === 'A' ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace />
  )
}
