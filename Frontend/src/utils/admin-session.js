export const ADMIN_SESSION_KEY = 'workpulse.admin.session.v1'
export const ADMIN_IDLE_MS = 5 * 60 * 1000

export function isIdle(lastActivityAt, now) {
  return (
    !Number.isFinite(lastActivityAt) ||
    lastActivityAt > now ||
    now - lastActivityAt >= ADMIN_IDLE_MS
  )
}

export function readSession(storage, now) {
  const raw = storage.getItem(ADMIN_SESSION_KEY)
  if (!raw) return { session: null, reason: '' }
  try {
    const session = JSON.parse(raw)
    if (
      !session ||
      typeof session.accessToken !== 'string' ||
      !session.accessToken ||
      session.accessToken.length > 8192 ||
      typeof session.refreshToken !== 'string' ||
      !session.refreshToken ||
      session.refreshToken.length > 1024 ||
      !Number.isFinite(session.expiresAt)
    )
      throw new Error()
    if (isIdle(session.lastActivityAt, now)) {
      storage.removeItem(ADMIN_SESSION_KEY)
      return { session: null, reason: 'idle', expiredSession: session }
    }
    // User identity and role are deliberately not restored from storage.
    return {
      session: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        lastActivityAt: session.lastActivityAt,
      },
      reason: '',
    }
  } catch {
    storage.removeItem(ADMIN_SESSION_KEY)
    return { session: null, reason: '' }
  }
}

export function writeSession(storage, session) {
  storage.setItem(
    ADMIN_SESSION_KEY,
    JSON.stringify({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      lastActivityAt: session.lastActivityAt,
    }),
  )
}
