import { copyProfile } from '../data/profile.js'

const languageCodes = {
  'English (United States)': 'en-US',
  'English (United Kingdom)': 'en-GB',
  Sinhala: 'si',
  Tamil: 'ta',
}
export function profileFromApi(row, preferences = {}) {
  if (!row || typeof row.id !== 'string')
    throw new Error('The profile service returned an invalid profile.')
  const language =
    row.language === 'en'
      ? 'English (United States)'
      : Object.keys(languageCodes).find(
          (name) => languageCodes[name] === row.language,
        ) ||
        row.language ||
        'English (United States)'
  return {
    profile: {
      ...copyProfile(),
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      phone: row.phone || '',
      language,
      timezone: row.timezone || 'UTC',
      photo: row.avatar || '',
      notifications: preferencesFromApi(preferences),
    },
    account: {
      id: row.id,
      email: row.email || '',
      employeeId: row.employee_code || '',
      department: row.department_name || '',
      role: { A: 'Admin', M: 'Manager', E: 'Employee' }[row.role] || '',
      createdAt: row.created_at || null,
    },
  }
}
export function preferencesFromApi(row) {
  return {
    daily: row.emailDailySummary === true,
    idle: row.idleAlerts === true,
    weekly: row.emailWeeklyReport === true,
  }
}
// Only editable personal fields are sent. Identity/role/department remain server-owned.
export function personalInformationPayload(profile) {
  return {
    firstName: profile.firstName.trim(),
    lastName: profile.lastName.trim(),
    phone: profile.phone.trim(),
    language: languageCodes[profile.language] || profile.language,
    timezone: profile.timezone,
  }
}
