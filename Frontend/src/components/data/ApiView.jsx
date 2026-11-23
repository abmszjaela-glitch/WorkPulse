import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts'
import Sidebar from '../layout/Sidebar.jsx'
import PageHeader from '../layout/PageHeader.jsx'

import {
  panelClass,
  fieldClass,
  categoryColors,
  duration,
} from '../../utils/analytics.js'
export function ApiPage({ title, subtitle, resource, children, actions }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="dashboard-shell">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="dashboard-workspace">
        <PageHeader
          title={title}
          subtitle={subtitle}
          onMenuOpen={() => setOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="dashboard-content space-y-6 py-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted">
              {resource.loading
                ? 'Loading database records…'
                : resource.loadedAt
                  ? `Updated ${resource.loadedAt.toLocaleTimeString()}`
                  : 'Choose filters to load data'}
            </span>
            <div className="flex flex-wrap gap-2">
              {actions}
              <button
                type="button"
                className={fieldClass}
                onClick={resource.reload}
              >
                <RefreshCw size={14} className="mr-2 inline" />
                Refresh
              </button>
            </div>
          </div>
          {Object.entries(resource.errors).map(([name, error]) => (
            <div
              key={name}
              role="alert"
              className="rounded-xl border border-error/20 bg-red-50 p-4 text-sm text-error"
            >
              {name}: {error}
            </div>
          ))}
          {children}
        </main>
      </div>
    </div>
  )
}
export function Panel({ title, subtitle, children, className = '' }) {
  return (
    <section className={`${panelClass} ${className}`}>
      <h2 className="text-base font-semibold text-primary-dark">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}
export function Metrics({ items }) {
  return (
    <section
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Summary metrics"
    >
      {items.map(([label, value, detail]) => (
        <article key={label} className={panelClass}>
          <h2 className="text-sm text-muted">{label}</h2>
          <strong className="mt-3 block text-3xl text-primary-dark">
            {value ?? '—'}
          </strong>
          {detail && <p className="mt-2 text-xs text-muted">{detail}</p>}
        </article>
      ))}
    </section>
  )
}
export function ApiTable({
  columns,
  rows = [],
  rowKey = (row) => row.id,
  empty = 'No records for these filters.',
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-soft text-xs uppercase text-muted">
          <tr>
            {columns.map(([label]) => (
              <th key={label} className="whitespace-nowrap px-3 py-3">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row) ?? index} className="border-b border-line/50">
              {columns.map(([label, render]) => (
                <td key={label} className="px-3 py-4">
                  {typeof render === 'function'
                    ? render(row)
                    : (row[render] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="py-8 text-center text-sm text-muted">{empty}</p>
      )}
    </div>
  )
}
export function Pagination({ page, pageSize, total, onPage }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
      <span>
        {total == null ? 'Total unavailable' : `${total} records`} · Page {page}
      </span>
      <div className="flex gap-2">
        <button
          className={fieldClass}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          className={fieldClass}
          disabled={total == null || page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
export function DateFilters({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-3">
      {['from', 'to'].map((key) => (
        <label key={key} className="text-xs text-muted">
          {key === 'from' ? 'From' : 'To'}
          <input
            className={`${fieldClass} ml-2`}
            type="date"
            aria-label={key === 'from' ? 'From date' : 'To date'}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
    </div>
  )
}
export function DailyBars({ data = [] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data.map((row) => ({
            ...row,
            active: row.active_seconds / 3600,
            idle: row.idle_seconds / 3600,
          }))}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" />
          <YAxis unit="h" />
          <Tooltip />
          <Legend />
          <Bar
            dataKey="active"
            name="Active hours"
            fill="#2563EB"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="idle"
            name="Idle hours"
            fill="#F59E0B"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
export function CategoryChart({ items = [] }) {
  return (
    <>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items.filter((row) => row.seconds > 0)}
              dataKey="seconds"
              nameKey="category"
              innerRadius="65%"
              outerRadius="90%"
            >
              {items
                .filter((row) => row.seconds > 0)
                .map((row) => (
                  <Cell
                    key={row.category}
                    fill={categoryColors[row.category]}
                  />
                ))}
            </Pie>
            <Tooltip formatter={duration} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2">
        {items.map((row) => (
          <div key={row.category} className="flex justify-between text-sm">
            <span style={{ color: categoryColors[row.category] }}>
              {row.category}
            </span>
            <span>
              {duration(row.seconds)} ·{' '}
              {row.percentage == null ? '—' : `${row.percentage.toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
export function UsageTrend({ data = [] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip formatter={duration} />
          <Legend />
          {Object.entries(categoryColors).map(([name, color]) => (
            <Line
              key={name}
              dataKey={`${name.toLowerCase()}_seconds`}
              name={name}
              stroke={color}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
