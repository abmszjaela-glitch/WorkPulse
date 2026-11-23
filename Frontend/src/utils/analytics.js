export const panelClass =
  'rounded-2xl border border-line/60 bg-white p-5 shadow-card sm:p-6'
export const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary'
export const actionClass =
  'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50'
export const categoryColors = {
  Productive: '#16A34A',
  Neutral: '#2563EB',
  Unproductive: '#DC2626',
  Unclassified: '#94A3B8',
}
export function duration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const value = Math.max(0, Math.round(Number(seconds)))
  return `${Math.floor(value / 3600)}h ${String(Math.floor(value / 60) % 60).padStart(2, '0')}m ${String(value % 60).padStart(2, '0')}s`
}
export function dateToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
export function rangeDays(days = 7) {
  const to = dateToday()
  return {
    from: new Date(Date.parse(to) - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    to,
  }
}
export const employeeName = (row) =>
  [row?.first_name, row?.last_name].filter(Boolean).join(' ') ||
  row?.email ||
  '—'
