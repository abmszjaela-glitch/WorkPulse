import { apiBaseUrl } from '../config/api.js'

export async function employeeRequest(
  token,
  path,
  { method = 'GET', body, signal, csv = false } = {},
) {
  if (!token) throw new Error('Sign in again to manage employees.')
  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
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
      'Cannot connect to employee storage. Check the directory before retrying a save.',
      { cause: error },
    )
  }
  if (!response.ok) {
    const error = new Error(
      {
        400: 'Check the employee fields and try again.',
        401: 'Your session has expired. Sign in again.',
        403: 'Administrator permission is required for this action.',
        404: 'This employee or department no longer exists. Reload the directory.',
        409: 'The email or employee ID may already exist, or this action conflicts with existing assignments.',
        413: 'Narrow the export filters before downloading.',
        429: 'Too many requests. Please try again later.',
        503: 'Employee storage is unavailable. Ask your administrator to check the management database setup.',
      }[response.status] || 'Employee request failed. Please try again.',
    )
    error.status = response.status
    throw error
  }
  if (response.status === 204) return null
  if (csv) return response.text()
  try {
    return await response.json()
  } catch {
    throw new Error(
      'Employee service returned an invalid response. Reload the directory.',
    )
  }
}
const roleCodes = { Admin: 'A', Manager: 'M', Employee: 'E' }
export function employeeQuery(filters) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries({
    ...filters,
    role: roleCodes[filters.role] || filters.role,
    status:
      filters.status === 'Deactivated'
        ? 'inactive'
        : filters.status === 'Active'
          ? 'active'
          : filters.status,
  }))
    if (value !== undefined && value !== null && value !== '')
      query.set(key, String(value))
  return query.toString()
}
export const listEmployees = (token, filters, signal) =>
  employeeRequest(token, `/employees?${employeeQuery(filters)}`, { signal })
export const employeeSummary = (token, signal) =>
  employeeRequest(token, '/employees/summary', { signal })
export const createEmployee = (token, body) =>
  employeeRequest(token, '/employees', { method: 'POST', body })
export const updateEmployee = (token, id, body) =>
  employeeRequest(token, `/employees/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  })
export const deactivateEmployees = (token, ids) =>
  employeeRequest(token, '/employees/bulk-deactivate', {
    method: 'POST',
    body: { ids },
  })
export const assignDepartment = (token, id, departmentId) =>
  employeeRequest(token, `/employees/${encodeURIComponent(id)}/department`, {
    method: 'PATCH',
    body: { departmentId: departmentId || null },
  })
export const setEmployeeStatus = (token, id, active) =>
  employeeRequest(token, `/employees/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: { active },
  })
export const exportEmployees = (token, filters) =>
  employeeRequest(token, `/employees/export?${employeeQuery(filters)}`, {
    csv: true,
  })
export async function listDepartmentOptions(token, signal) {
  const rows = []
  let page = 1,
    total
  do {
    const result = await employeeRequest(
      token,
      `/departments?page=${page}&pageSize=100`,
      { signal },
    )
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total))
      throw new Error('Department service returned an invalid response.')
    total = result.total
    if (result.items.length === 0 && rows.length < total)
      throw new Error('Department pagination returned an incomplete directory.')
    if (total > 10000)
      throw new Error(
        'Department directory is too large to load into a selector.',
      )
    rows.push(...result.items)
    page++
  } while (rows.length < total)
  return rows
}
