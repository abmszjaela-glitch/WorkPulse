import { useEffect, useState } from 'react'
import { AuthContext } from './AuthContext.js'
import { loginAdmin, logoutAdmin } from '../services/auth.js'

export default function AuthProvider({ children }) {
  // Memory only: reloads require sign-in; no passwords or tokens in browser storage.
  const [session, setSession] = useState(null)
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(
      () => setSession(null),
      Math.max(0, session.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [session])
  async function login({ email, password }) {
    const authenticated = await loginAdmin(email, password)
    setSession(authenticated)
  }
  async function logout() {
    const token = session?.accessToken
    setSession(null)
    if (token) await logoutAdmin(token).catch(() => {})
  }
  return (
    <AuthContext.Provider value={{ session, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
