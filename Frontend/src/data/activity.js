export const activityEmployee = {
  name: 'No employee selected',
  initials: '',
  id: '',
  title: '',
  department: '',
  email: '',
  workstation: '',
}
export const hourlyActivity = []
export const activityApps = []
export const timeDistribution = []
export const activityTrend = []

export const activityLogs = []
export const formatMinutes = (minutes) =>
  `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60 ? `${String(minutes % 60).padStart(2, '0')}m` : ''}`.trim() ||
  '0m'
export function filterActivityLogs(rows, search, status) {
  const term = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!status || row.status === status) &&
      `${row.range} ${row.app} ${row.context} ${row.status}`
        .toLowerCase()
        .includes(term),
  )
}
export function activityLogsCsv(rows) {
  const fields = [
    'range',
    'status',
    'app',
    'context',
    'mouse',
    'keys',
    'duration',
  ]
  const escape = (value) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`
  return [fields, ...rows.map((row) => fields.map((field) => row[field]))]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
}
