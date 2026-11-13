export const activityEmployee = {
  name: 'Nimal Perera',
  initials: 'NP',
  id: 'EMP-0042',
  title: 'Software Engineer',
  department: 'Engineering',
  email: 'nimal.p@workpulse.io',
  workstation: 'DESKTOP-WP042',
}
export const hourlyActivity = [
  { hour: '8 AM', active: 27, idle: 9, offline: 24 },
  { hour: '9 AM', active: 54, idle: 6, offline: 0 },
  { hour: '10 AM', active: 48, idle: 12, offline: 0 },
  { hour: '11 AM', active: 55, idle: 5, offline: 0 },
  { hour: '12 PM', active: 9, idle: 9, offline: 42 },
  { hour: '1 PM', active: 52, idle: 8, offline: 0 },
  { hour: '2 PM', active: 50, idle: 10, offline: 0 },
  { hour: '3 PM', active: 51, idle: 9, offline: 0 },
  { hour: '4 PM', active: 31, idle: 9, offline: 20 },
  { hour: '5 PM', active: 1, idle: 7, offline: 52 },
]
export const activityApps = [
  {
    name: 'Visual Studio Code',
    category: 'Productive',
    minutes: 165,
    color: '#2563eb',
  },
  {
    name: 'Google Chrome',
    category: 'Neutral',
    minutes: 110,
    color: '#53649b',
  },
  { name: 'Slack', category: 'Productive', minutes: 75, color: '#00652b' },
  {
    name: 'Microsoft Teams',
    category: 'Productive',
    minutes: 52,
    color: '#2563eb',
  },
  { name: 'Figma', category: 'Productive', minutes: 40, color: '#0750ca' },
  { name: 'YouTube', category: 'Unproductive', minutes: 20, color: '#c5161d' },
]
export const timeDistribution = [
  { name: 'Productive', minutes: 332, color: '#16a34a' },
  { name: 'Neutral', minutes: 110, color: '#2563eb' },
  { name: 'Unproductive', minutes: 20, color: '#dc2626' },
]
export const activityTrend = [
  { day: 'MON', active: 4.2, idle: 0.7 },
  { day: 'TUE', active: 5.6, idle: 1 },
  { day: 'WED', active: 6.5, idle: 0.4 },
  { day: 'THU', active: 6.8, idle: 0.6 },
  { day: 'FRI', active: 6.3, idle: 1.4 },
  { day: 'SAT', active: 3.8, idle: 1.2 },
  { day: 'SUN', active: 5.9, idle: 0.6 },
]
const logTemplates = [
  ['Active', 'Visual Studio Code', 'Development workspace', 412, 1024],
  ['Active', 'Visual Studio Code', 'Unit testing workspace', 389, 890],
  ['Active', 'Slack', 'Team collaboration', 245, 430],
  ['Neutral', 'Google Chrome', 'Technical documentation', 512, 120],
  ['Active', 'Visual Studio Code', 'Development workspace', 480, 1150],
  ['Idle', 'System Idle (Break)', 'No user interaction detected', 0, 0],
  ['Active', 'Microsoft Teams', 'Team meeting', 98, 64],
  ['Active', 'Visual Studio Code', 'Development workspace', 542, 1340],
]
const clock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
export const activityLogs = Array.from({ length: 36 }, (_, index) => {
  const [status, app, context, mouse, keys] =
    logTemplates[index % logTemplates.length]
  return {
    id: index + 1,
    range: `${clock(540 + index * 15)} – ${clock(555 + index * 15)}`,
    status,
    app,
    context,
    mouse,
    keys,
    duration: '15m 00s',
  }
})
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
