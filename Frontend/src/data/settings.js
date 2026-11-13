export const SETTINGS_KEY = 'workpulse.settings.preview.v1'
export const settingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const defaultSettings = {
  version: 1, idleMinutes: 5, evaluationSeconds: 60, syncMinutes: 5, offlineDays: 7,
  trackApplications: true, trackKeyboardCounts: true, trackMouseCounts: true, pauseOutsideHours: true,
  retentionDays: 90, requireConsent: true, notifyIdle: true, notifyAgentOffline: true, weeklyDigest: false,
  sessionMinutes: 30, requireMfa: false,
  schedule: settingDays.map((day, index) => ({ day, enabled: index < 5, start: '09:00', end: index === 4 ? '17:00' : '17:30' })),
  rules: [
    { id: 'vscode', name: 'Visual Studio Code', category: 'Productive', scope: 'All Departments' },
    { id: 'chrome', name: 'Google Chrome', category: 'Neutral', scope: 'All Departments' },
    { id: 'slack', name: 'Slack', category: 'Productive', scope: 'All Departments' },
    { id: 'youtube', name: 'YouTube', category: 'Unproductive', scope: 'All Departments' },
    { id: 'facebook', name: 'Facebook', category: 'Unproductive', scope: 'All Departments' },
  ],
  policy: 'Activity monitoring requires transparent disclosure and employee consent. Only aggregate activity counts and application usage durations are included in this preview. Keystroke content, screenshots and confidential messages are not collected.',
}
export const cloneSettings = (value = defaultSettings) => JSON.parse(JSON.stringify(value))
export function shiftHours(start, end) {
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!valid.test(start) || !valid.test(end) || start === end) return null
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  return ((minutes(end) - minutes(start) + 1440) % 1440) / 60
}
export function validateSettings(settings) {
  if (!settings || settings.version !== 1) return 'Unsupported settings format.'
  if (!Number.isInteger(settings.idleMinutes) || settings.idleMinutes < 1 || settings.idleMinutes > 30) return 'Idle threshold must be between 1 and 30 minutes.'
  if (![30, 60, 120, 300].includes(settings.evaluationSeconds) || ![1, 5, 15, 30].includes(settings.syncMinutes)) return 'Select a valid evaluation and sync interval.'
  if (!Number.isInteger(settings.offlineDays) || settings.offlineDays < 1 || settings.offlineDays > 30) return 'Offline storage must be between 1 and 30 days.'
  if (![30, 60, 90, 180, 365].includes(settings.retentionDays) || ![15, 30, 60, 120].includes(settings.sessionMinutes)) return 'Select valid retention and session durations.'
  for (const key of ['trackApplications', 'trackKeyboardCounts', 'trackMouseCounts', 'pauseOutsideHours', 'requireConsent', 'notifyIdle', 'notifyAgentOffline', 'weeklyDigest', 'requireMfa']) if (typeof settings[key] !== 'boolean') return 'Invalid toggle setting.'
  if (!Array.isArray(settings.schedule) || settings.schedule.length !== 7 || !settings.schedule.every((row, index) => row.day === settingDays[index] && typeof row.enabled === 'boolean' && shiftHours(row.start, row.end) !== null)) return 'Each day must have valid, different start and end times. Overnight shifts are supported.'
  if (!Array.isArray(settings.rules) || settings.rules.length > 100 || settings.rules.some((rule) => !rule || typeof rule.id !== 'string' || typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 100 || !['Productive', 'Neutral', 'Unproductive'].includes(rule.category) || typeof rule.scope !== 'string' || !rule.scope.trim() || rule.scope.length > 100)) return 'Check the application category rules.'
  const keys = settings.rules.map((rule) => `${rule.name.trim().toLowerCase()}|${rule.scope}`)
  if (new Set(keys).size !== keys.length || new Set(settings.rules.map((rule) => rule.id)).size !== settings.rules.length) return 'Duplicate application rules are not allowed for the same scope.'
  if (typeof settings.policy !== 'string' || !settings.policy.trim() || settings.policy.length > 5000) return 'Privacy documentation must contain between 1 and 5,000 characters.'
  return null
}
export function loadSettings(storage) {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { settings: cloneSettings(), notice: '' }
    const parsed = JSON.parse(raw)
    if (validateSettings(parsed)) throw new Error('Invalid settings')
    return { settings: cloneSettings(parsed), notice: '' }
  } catch {
    return { settings: cloneSettings(), notice: 'Saved preview settings could not be loaded. Default settings are shown.' }
  }
}
