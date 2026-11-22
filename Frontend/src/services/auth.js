import { apiBaseUrl as baseUrl } from '../config/api.js'

async function request(path, { token, body, method = 'GET' } = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}/auth${path}`, {
      method,
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
    throw new Error(
      response.status === 401
        ? 'Invalid email or password.'
        : response.status === 429
          ? 'Too many sign-in attempts. Please try again later.'
          : 'Sign in is unavailable. Please contact your administrator.',
    )
  }
  if (response.status === 204) return null
  try {
    return await response.json()
  } catch {
    throw new Error('Invalid sign-in response. Please try again.')
  }
}

export async function loginAdmin(email, password) {
  const session = await request('/login', {
    method: 'POST',
    body: { email, password },
  })
  if (
    typeof session.accessToken !== 'string' ||
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
      user: account.user,
      expiresAt: Date.now() + session.expiresIn * 1000,
    }
  } catch (error) {
    await logoutAdmin(session.accessToken).catch(() => {})
    throw error
  }
}

export function logoutAdmin(token) {
  return request('/logout', { method: 'POST', token })
}
