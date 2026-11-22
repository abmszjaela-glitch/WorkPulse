import { apiBaseUrl as baseUrl } from '../config/api.js'

async function request(path, { token, body, method = 'GET' } = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}/auth${path}`, {
      method,
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new Error('Cannot connect to the sign-in service. Please try again.')
  }
  if (!response.ok) {
    const error = new Error(
      response.status === 401
        ? 'Invalid email or password.'
        : response.status === 429
          ? 'Too many sign-in attempts. Please try again later.'
          : 'Sign in is unavailable. Please contact your administrator.',
    )
    error.status = response.status
    throw error
  }
  if (response.status === 204) return null
  try {
    return await response.json()
  } catch {
    throw new Error('Invalid sign-in response. Please try again.')
  }
}

async function verifySession(session) {
  if (
    typeof session.accessToken !== 'string' ||
    typeof session.refreshToken !== 'string' ||
    !session.refreshToken ||
    !Number.isFinite(session.expiresIn) ||
    session.expiresIn <= 0
  )
    throw new Error('Invalid sign-in response. Please try again.')
  try {
    const account = await request('/me', { token: session.accessToken })
    if (account.role === 'Agent' || account.user?.role !== 'A')
      throw new Error('An administrator account is required.')
    if (account.user.mustChangePassword)
      throw new Error(
        'Change your temporary password before using the admin dashboard. Contact your administrator.',
      )
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: account.user,
      expiresAt: Date.now() + session.expiresIn * 1000,
    }
  } catch (error) {
    await logoutAdmin(session.accessToken).catch(() => {})
    throw error
  }
}

export async function loginAdmin(email, password) {
  return verifySession(
    await request('/login', { method: 'POST', body: { email, password } }),
  )
}

// Share refresh rotation across React StrictMode's duplicate effect setup.
const refreshes = new Map()
export function refreshAdminSession(session) {
  if (refreshes.has(session.refreshToken))
    return refreshes.get(session.refreshToken)
  const pending = request('/refresh', {
    method: 'POST',
    body: { refreshToken: session.refreshToken },
  })
    .then(verifySession)
    .finally(() => refreshes.delete(session.refreshToken))
  refreshes.set(session.refreshToken, pending)
  return pending
}

export async function restoreAdminSession(session) {
  if (session.expiresAt <= Date.now() + 30000)
    return refreshAdminSession(session)
  const account = await request('/me', { token: session.accessToken })
  if (
    account.role === 'Agent' ||
    account.user?.role !== 'A' ||
    account.user.mustChangePassword
  )
    throw new Error('An active administrator account is required.')
  return { ...session, user: account.user }
}

export function logoutAdmin(token) {
  return request('/logout', { method: 'POST', token })
}
