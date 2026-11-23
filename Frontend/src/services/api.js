import { apiBaseUrl } from '../config/api.js'

export function queryString(values = {}) {
  return new URLSearchParams(
    Object.entries(values).filter(([, v]) => v !== '' && v != null),
  ).toString()
}

export async function apiRequest(
  token,
  path,
  { method = 'GET', body, signal, file = false } = {},
) {
  if (!token) throw new Error('Sign in to access WorkPulse data.')
  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(
      'Cannot reach WorkPulse. Check the backend connection and retry.',
      { cause: error },
    )
  }
  if (!response.ok) {
    const error = new Error(
      {
        400: 'Check the supplied fields and date filters.',
        401: 'Session expired. Sign in again.',
        403: 'You do not have permission for this data.',
        404: 'The selected record or policy is unavailable.',
        409: 'This operation conflicts with existing data. Reload and try again.',
        413: 'Narrow the filters before exporting.',
        429: 'Too many requests. Please wait and retry.',
        503: 'This data service is unavailable. Check the deployed database migrations and backend configuration.',
      }[response.status] || 'The WorkPulse request failed. Please retry.',
    )
    error.status = response.status
    throw error
  }
  if (response.status === 204) return null
  return file ? response.blob() : response.json()
}

export async function downloadApiFile(token, path, filename) {
  const blob = await apiRequest(token, path, { file: true })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
