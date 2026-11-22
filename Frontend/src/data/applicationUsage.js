export const applicationCategories = ['Productive', 'Neutral', 'Unproductive']
export const applicationColors = {
  Productive: '#00652b',
  Neutral: '#2563eb',
  Unproductive: '#c5161d',
}
export const trackedApplications = []
export const usageEmployees = []
export const usageDepartments = []

export const usageRecords = []
export function summarizeApplications(apps, filters) {
  const records = usageRecords.filter(
    (record) =>
      record.period === filters.period &&
      (!filters.department || record.department === filters.department) &&
      (!filters.employee || record.employeeId === filters.employee),
  )
  const cohort = new Set(records.map((record) => record.employeeId)).size
  const totals = apps
    .map((app) => {
      const matches = records.filter(
        (record) => record.appId === app.id && record.minutes > 0,
      )
      const totalMinutes = matches.reduce(
        (sum, record) => sum + record.minutes,
        0,
      )
      return {
        ...app,
        totalMinutes,
        users: new Set(matches.map((record) => record.employeeId)).size,
        cohort,
      }
    })
    .filter(
      (app) =>
        app.totalMinutes > 0 &&
        (!filters.category || app.category === filters.category),
    )
  const totalMinutes = totals.reduce((sum, app) => sum + app.totalMinutes, 0)
  return totals
    .map((app) => ({
      ...app,
      share: totalMinutes ? (app.totalMinutes / totalMinutes) * 100 : 0,
      averageMinutes: Math.round(app.totalMinutes / Math.max(1, app.users)),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}
export function getCategoryTotals(apps) {
  return applicationCategories.map((name) => ({
    name,
    minutes: apps
      .filter((app) => app.category === name)
      .reduce((sum, app) => sum + app.totalMinutes, 0),
    color: applicationColors[name],
  }))
}
export function formatUsageTime(minutes) {
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`
}
export function usageCsv(apps) {
  const escape = (value) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`
  return [
    [
      'Application',
      'Category',
      'Total time',
      'Average per employee',
      'Users',
      'Usage share',
    ],
    ...apps.map((app) => [
      app.name,
      app.category,
      formatUsageTime(app.totalMinutes),
      formatUsageTime(app.averageMinutes),
      app.users,
      `${app.share.toFixed(1)}%`,
    ]),
  ]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
}
export function getUsageTrend() {
  return []
}
