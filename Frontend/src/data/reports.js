import { managementEmployees } from './employees.js'
export const reportDepartments = [...new Set(managementEmployees.map((employee) => employee.department))]
export const reportEmployees = managementEmployees
const weekly = [
  [2470, 2200, 5, 'VS Code'], [2355, 1790, 5, 'Google Chrome'], [2400, 2000, 5, 'Figma'], [2310, 1665, 5, 'Salesforce'],
  [2535, 2230, 5, 'VS Code'], [2265, 1515, 4, 'Zendesk'], [2430, 2020, 5, 'Slack'], [1690, 920, 3, 'Google Chrome'],
]
export const formatReportTime = (minutes) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`
export function buildReport({ days = 7, department = '', employee = '', type = 'Summary' } = {}) {
  const workDays = days === 1 ? 1 : days === 30 ? 22 : 5
  const rows = managementEmployees.map((person, index) => {
    const [total, active, present, app] = weekly[index]
    const daysPresent = days === 1 ? Number(present >= 4) : Math.round(present / 5 * workDays)
    const scale = days === 1 && !daysPresent ? 0 : workDays / 5
    const totalMinutes = Math.round(total * scale)
    const activeMinutes = Math.round(active * scale)
    return { ...person, totalMinutes, activeMinutes, idleMinutes: totalMinutes - activeMinutes, productivity: totalMinutes ? Math.round(activeMinutes / totalMinutes * 100) : 0, present: daysPresent, workDays, app }
  }).filter((row) => (!department || row.department === department) && (!employee || row.id === employee))
  if (type === 'Productivity') rows.sort((a, b) => b.productivity - a.productivity)
  if (type === 'Attendance') rows.sort((a, b) => b.present - a.present || a.name.localeCompare(b.name))
  const totalMinutes = rows.reduce((sum, row) => sum + row.totalMinutes, 0)
  const activeMinutes = rows.reduce((sum, row) => sum + row.activeMinutes, 0)
  const idleMinutes = totalMinutes - activeMinutes
  const present = rows.reduce((sum, row) => sum + row.present, 0)
  const denominator = rows.length * workDays
  const groups = [...new Set(rows.map((row) => row.department))].map((name) => {
    const members = rows.filter((row) => row.department === name)
    const total = members.reduce((sum, row) => sum + row.totalMinutes, 0)
    const active = members.reduce((sum, row) => sum + row.activeMinutes, 0)
    return { name, staff: members.length, total, active, idle: total - active, productivity: total ? Math.round(active / total * 100) : 0 }
  }).sort((a, b) => b.productivity - a.productivity)
  return { rows, groups, workDays, totalMinutes, activeMinutes, idleMinutes, avgActive: denominator ? Math.round(activeMinutes / denominator) : 0, avgIdle: denominator ? Math.round(idleMinutes / denominator) : 0, avgDaily: denominator ? Math.round(totalMinutes / denominator) : 0, productivity: totalMinutes ? Math.round(activeMinutes / totalMinutes * 100) : 0, attendance: denominator ? Math.round(present / denominator * 100) : 0, overtime: rows.reduce((sum, row) => sum + Math.max(0, row.totalMinutes - row.present * 480), 0) }
}
export function reportChartData(report, days) {
  const labels = days === 1 ? ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM'] : days === 30 ? ['Week 1', 'Week 2', 'Week 3', 'Week 4'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const factors = [0.95, 1.03, 0.91, 1.08, 0.86, 0.44, 0.32, 0.82]
  return labels.map((day, index) => ({ day, active: +(report.avgActive / 60 * factors[index]).toFixed(2), idle: +(report.avgIdle / 60 * (1.1 - factors[index] * 0.35)).toFixed(2), productivity: report.rows.length ? Math.min(100, Math.max(0, report.productivity + [-4, 1, 0, 3, 6, -3, -9, -2][index])) : 0 }))
}
export function reportCsv(rows, grouping = 'Employee') {
  const fields = grouping === 'Department' ? ['Department', 'Employees', 'Total time', 'Active time', 'Idle time', 'Productivity'] : ['Employee', 'ID', 'Department', 'Role', 'Total hours', 'Active time', 'Idle time', 'Productivity', 'Top application', 'Days present']
  const records = grouping === 'Department' ? rows.map((row) => [row.name, row.staff, formatReportTime(row.total), formatReportTime(row.active), formatReportTime(row.idle), `${row.productivity}%`]) : rows.map((row) => [row.name, row.id, row.department, row.role, formatReportTime(row.totalMinutes), formatReportTime(row.activeMinutes), formatReportTime(row.idleMinutes), `${row.productivity}%`, row.app, `${row.present}/${row.workDays}`])
  const escape = (value) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
  return [fields, ...records].map((row) => row.map(escape).join(',')).join('\r\n')
}
