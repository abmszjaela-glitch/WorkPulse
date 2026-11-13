import { managementEmployees } from './employees.js'

export const applicationCategories = ['Productive', 'Neutral', 'Unproductive']
export const applicationColors = { Productive: '#00652b', Neutral: '#2563eb', Unproductive: '#c5161d' }
export const trackedApplications = [
  { id: 'vscode', name: 'Visual Studio Code', shortName: 'VS Code', description: 'Code Editor · Desktop', category: 'Productive', minutes: 685 },
  { id: 'chrome', name: 'Google Chrome', description: 'Web Browser · Cross-platform', category: 'Neutral', minutes: 570 },
  { id: 'slack', name: 'Slack', description: 'Internal Messaging', category: 'Productive', minutes: 396 },
  { id: 'teams', name: 'Microsoft Teams', description: 'Unified Collaboration', category: 'Productive', minutes: 312 },
  { id: 'excel', name: 'Microsoft Excel', description: 'Spreadsheets · Finance', category: 'Neutral', minutes: 224 },
  { id: 'figma', name: 'Figma', description: 'Collaborative Design', category: 'Productive', minutes: 188 },
  { id: 'zoom', name: 'Zoom', description: 'Video Conferencing', category: 'Productive', minutes: 164 },
  { id: 'notion', name: 'Notion', description: 'Notes · Workspace', category: 'Productive', minutes: 136 },
  { id: 'youtube', name: 'YouTube', description: 'Streaming Video', category: 'Unproductive', minutes: 92 },
  { id: 'facebook', name: 'Facebook', description: 'Social Network', category: 'Unproductive', minutes: 36 },
]
export const usageEmployees = managementEmployees.map(({ id, name, department }) => ({ id, name, department }))
export const usageDepartments = [...new Set(usageEmployees.map((employee) => employee.department))]
const employeeWeights = [1.25, 1.1, 0.95, 0.8, 1.15, 0.9, 1, 0.85]
export const usageRecords = trackedApplications.flatMap((app, appIndex) => usageEmployees.flatMap((employee, employeeIndex) => ['today', 'yesterday'].map((period) => ({
  appId: app.id, employeeId: employee.id, department: employee.department, period,
  minutes: Math.round(app.minutes / 8 * employeeWeights[employeeIndex] * (period === 'today' ? 1 : 0.78 + (appIndex % 3) * 0.08)),
}))))
export function summarizeApplications(apps, filters) {
  const records = usageRecords.filter((record) => record.period === filters.period && (!filters.department || record.department === filters.department) && (!filters.employee || record.employeeId === filters.employee))
  const cohort = new Set(records.map((record) => record.employeeId)).size
  const totals = apps.map((app) => {
    const matches = records.filter((record) => record.appId === app.id && record.minutes > 0)
    const totalMinutes = matches.reduce((sum, record) => sum + record.minutes, 0)
    return { ...app, totalMinutes, users: new Set(matches.map((record) => record.employeeId)).size, cohort }
  }).filter((app) => app.totalMinutes > 0 && (!filters.category || app.category === filters.category))
  const totalMinutes = totals.reduce((sum, app) => sum + app.totalMinutes, 0)
  return totals.map((app) => ({ ...app, share: totalMinutes ? app.totalMinutes / totalMinutes * 100 : 0, averageMinutes: Math.round(app.totalMinutes / Math.max(1, app.users)) })).sort((a, b) => b.totalMinutes - a.totalMinutes)
}
export function getCategoryTotals(apps) {
  return applicationCategories.map((name) => ({ name, minutes: apps.filter((app) => app.category === name).reduce((sum, app) => sum + app.totalMinutes, 0), color: applicationColors[name] }))
}
export function formatUsageTime(minutes) {
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`
}
export function usageCsv(apps) {
  const escape = (value) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
  return [['Application', 'Category', 'Total time', 'Average per employee', 'Users', 'Usage share'], ...apps.map((app) => [app.name, app.category, formatUsageTime(app.totalMinutes), formatUsageTime(app.averageMinutes), app.users, `${app.share.toFixed(1)}%`])].map((row) => row.map(escape).join(',')).join('\r\n')
}
export function getUsageTrend(categories, cohort, days) {
  const factors = [0.92, 0.98, 1.08, 1.02, 0.96, 0.4, 0.31]
  return Array.from({ length: days }, (_, index) => ({
    day: days === 7 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index] : `Day ${index + 1}`,
    ...Object.fromEntries(categories.map((category, categoryIndex) => [category.name, +(category.minutes / Math.max(1, cohort) / 60 * factors[index % 7] * (categoryIndex === 2 ? 1 + (index % 4) * 0.07 : 1)).toFixed(2)])),
  }))
}
