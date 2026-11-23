import { apiBaseUrl } from '../config/api.js'

async function request(token, path = '', { body, signal } = {}) {
  if (!token) throw new Error('Sign in again before editing your profile.')
  let response
  try {
    response = await fetch(`${apiBaseUrl}/profile${path}`, {
      method: body ? 'PUT' : 'GET',
      signal,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(
      'Cannot connect to profile storage. Your edits have not been confirmed as saved.',
      { cause: error },
    )
  }
  if (!response.ok)
    throw new Error(
      {
        401: 'Your session has expired. Sign in again.',
        403: 'You are not authorized to edit this profile.',
        404: 'Your profile record was not found. Contact your administrator.',
        400: 'Check your personal information and try again.',
        503: 'Profile storage is unavailable. Please try again.',
      }[response.status] || 'Profile could not be saved. Please try again.',
    )
  try {
    return await response.json()
  } catch {
    throw new Error(
      'The profile service returned an invalid response. Please reload your profile.',
    )
  }
}

export const getProfile = (token, signal) => request(token, '', { signal })
export const updateProfile = (token, body) => request(token, '', { body })
export const getPreferences = (token, signal) =>
  request(token, '/notification-preferences', { signal })
export const updatePreferences = (token, notifications) =>
  request(token, '/notification-preferences', {
    body: {
      emailDailySummary: notifications.daily,
      idleAlerts: notifications.idle,
      emailWeeklyReport: notifications.weekly,
    },
  })
