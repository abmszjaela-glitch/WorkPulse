import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthContext } from './AuthContext.js'
import {
  loginAdmin,
  logoutAdmin,
  restoreAdminSession,
  refreshAdminSession,
} from '../services/auth.js'
import {
  ADMIN_SESSION_KEY,
  ADMIN_IDLE_MS,
  isIdle,
  readSession,
  writeSession,
} from '../utils/admin-session.js'

function clearStoredSession() {
  try {
    window.sessionStorage.removeItem(ADMIN_SESSION_KEY)
  } catch {
    /* Keep local logout working if browser storage is blocked. */
  }
}
export default function AuthProvider({ children }) {
  const [state, setState] = useState({
    session: null,
    initializing: true,
    logoutReason: '',
  })
  const generation = useRef(0)
  const endSession = useCallback((reason, token) => {
    generation.current += 1
    clearStoredSession()
    setState({ session: null, initializing: false, logoutReason: reason })
    if (token) void logoutAdmin(token).catch(() => {})
  }, [])
  useEffect(() => {
    let active = true
    const expected = ++generation.current
    void Promise.resolve().then(async () => {
      if (!active) return
      try {
        const cached = readSession(window.sessionStorage, Date.now())
        if (!cached.session) {
          if (active)
            endSession(cached.reason, cached.expiredSession?.accessToken)
          return
        }
        const verified = await restoreAdminSession(cached.session)
        if (!active || generation.current !== expected) return
        if (isIdle(cached.session.lastActivityAt, Date.now())) {
          endSession('idle', verified.accessToken)
          return
        }
        const session = {
          ...verified,
          lastActivityAt: cached.session.lastActivityAt,
        }
        writeSession(window.sessionStorage, session)
        setState({ session, initializing: false, logoutReason: '' })
      } catch {
        if (active && generation.current === expected) endSession('restore')
      }
    })
    return () => {
      active = false
    }
  }, [endSession])
  useEffect(() => {
    const session = state.session
    if (!session) return
    let active = true,
      ended = false,
      refreshing = false,
      idleTimer,
      refreshTimer
    const expected = generation.current
    let lastActivityAt = session.lastActivityAt,
      lastWrittenAt = 0
    const finish = (reason) => {
      if (!active || ended || generation.current !== expected) return
      ended = true
      endSession(reason, session.accessToken)
    }
    function persist() {
      if (!active || ended || generation.current !== expected) return false
      try {
        writeSession(window.sessionStorage, { ...session, lastActivityAt })
        lastWrittenAt = Date.now()
        return true
      } catch {
        finish('storage')
        return false
      }
    }
    async function refresh() {
      if (!active || ended || refreshing || generation.current !== expected)
        return
      if (isIdle(lastActivityAt, Date.now())) {
        finish('idle')
        return
      }
      refreshing = true
      try {
        const renewed = await refreshAdminSession(session)
        if (!active || ended || generation.current !== expected) return
        if (isIdle(lastActivityAt, Date.now())) {
          finish('idle')
          return
        }
        const next = { ...renewed, lastActivityAt }
        writeSession(window.sessionStorage, next)
        generation.current += 1
        setState({ session: next, initializing: false, logoutReason: '' })
      } catch {
        finish('expired')
      }
    }
    function check() {
      if (!active || ended || generation.current !== expected) return false
      if (isIdle(lastActivityAt, Date.now())) {
        finish('idle')
        return false
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(
        check,
        Math.max(1, lastActivityAt + ADMIN_IDLE_MS - Date.now()),
      )
      if (session.expiresAt <= Date.now()) void refresh()
      return true
    }
    function activity(event) {
      if (
        !event.isTrusted ||
        !active ||
        ended ||
        generation.current !== expected
      )
        return
      const now = Date.now()
      // Late browser timers must expire before a new input can reset the clock.
      if (isIdle(lastActivityAt, now)) {
        finish('idle')
        return
      }
      lastActivityAt = now
      if (now - lastWrittenAt >= 1000) persist()
    }
    function visibility() {
      if (check() && document.hidden) persist()
    }
    function pageHide() {
      if (check()) persist()
    }
    check()
    refreshTimer = setTimeout(
      () => void refresh(),
      Math.max(1000, session.expiresAt - Date.now() - 30000),
    )
    const events = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
      'touchmove',
    ]
    for (const event of events)
      document.addEventListener(event, activity, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', check)
    window.addEventListener('pagehide', pageHide)
    return () => {
      active = false
      clearTimeout(idleTimer)
      clearTimeout(refreshTimer)
      for (const event of events) document.removeEventListener(event, activity)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('focus', check)
      window.removeEventListener('pagehide', pageHide)
    }
  }, [state.session, endSession])
  async function login(credentials) {
    const expected = ++generation.current
    const authenticated = await loginAdmin(
      credentials.email,
      credentials.password,
    )
    if (generation.current !== expected) {
      void logoutAdmin(authenticated.accessToken).catch(() => {})
      throw new Error('Sign in was cancelled. Please try again.')
    }
    const session = { ...authenticated, lastActivityAt: Date.now() }
    try {
      writeSession(window.sessionStorage, session)
    } catch {
      void logoutAdmin(session.accessToken).catch(() => {})
      throw new Error(
        'Browser session storage is unavailable. Enable it and sign in again.',
      )
    }
    setState({ session, initializing: false, logoutReason: '' })
  }
  function logout() {
    endSession('', state.session?.accessToken)
  }
  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
