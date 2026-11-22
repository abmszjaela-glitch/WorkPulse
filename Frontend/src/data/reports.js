import { managementEmployees } from './employees.js'
export const reportDepartments = [
  ...new Set(managementEmployees.map((employee) => employee.department)),
]
export const reportEmployees = managementEmployees

export const formatReportTime = (minutes) =>
  minutes == null
    ? '—'
    : `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`
export function buildReport() {
  return {
    rows: [],
    groups: [],
    workDays: null,
    totalMinutes: null,
    activeMinutes: null,
    idleMinutes: null,
    avgActive: null,
    avgIdle: null,
    avgDaily: null,
    productivity: null,
    attendance: null,
    overtime: null,
  }
}
export function reportChartData() {
  return []
}
export function reportCsv(rows, grouping = 'Employee') {
  const fields =
    grouping === 'Department'
      ? [
          'Department',
          'Employees',
          'Total time',
          'Active time',
          'Idle time',
          'Productivity',
        ]
      : [
          'Employee',
          'ID',
          'Department',
          'Role',
          'Total hours',
          'Active time',
          'Idle time',
          'Productivity',
          'Top application',
          'Days present',
        ]
  const records =
    grouping === 'Department'
      ? rows.map((row) => [
          row.name,
          row.staff,
          formatReportTime(row.total),
          formatReportTime(row.active),
          formatReportTime(row.idle),
          `${row.productivity}%`,
        ])
      : rows.map((row) => [
          row.name,
          row.id,
          row.department,
          row.role,
          formatReportTime(row.totalMinutes),
          formatReportTime(row.activeMinutes),
          formatReportTime(row.idleMinutes),
          `${row.productivity}%`,
          row.app,
          `${row.present}/${row.workDays}`,
        ])
  const escape = (value) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`
  return [fields, ...records]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
}
