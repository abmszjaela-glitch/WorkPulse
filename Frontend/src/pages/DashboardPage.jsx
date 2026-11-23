import PanelHeading from '../components/ui/SectionHeading.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronDown,
  CloudOff,
  Code2,
  Globe,
  Hourglass,
  MessageSquare,
  Palette,
  Sheet,
  UsersRound,
  Zap,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Sidebar from '../components/layout/Sidebar.jsx'
import useApiData from '../hooks/useApiData.js'
import { queryString } from '../services/api.js'
import {
  duration,
  employeeName,
  rangeDays,
  categoryColors,
} from '../utils/analytics.js'

const appIcons = [Code2, Globe, MessageSquare, Sheet, Palette]

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('This week')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('All')
  const range = rangeDays(7)
  if (period === 'Last week') {
    range.to = new Date(Date.parse(range.from) - 86400000)
      .toISOString()
      .slice(0, 10)
    range.from = new Date(Date.parse(range.to) - 6 * 86400000)
      .toISOString()
      .slice(0, 10)
  }
  const resource = useApiData({
    stats: '/dashboard/stats',
    trend: '/dashboard/active-vs-idle?' + queryString(range),
    usage: '/dashboard/app-usage-summary',
    live:
      '/dashboard/live-status?' +
      queryString({
        pageSize: 100,
        search,
        status: status === 'All' ? '' : status.toUpperCase(),
      }),
    apps: '/dashboard/top-apps',
    departments: '/dashboard/department-productivity?pageSize=100',
    daily: '/reports/daily?pageSize=100',
  })
  const stats = resource.data.stats?.data
  const daily = new Map(
    (resource.data.daily?.data || []).map((row) => [row.employee_id, row]),
  )
  const employees = (resource.data.live?.data || []).map((row) => ({
    ...row,
    name: employeeName(row),
    department: row.department_name || 'Unassigned',
    status: row.status[0] + row.status.slice(1).toLowerCase(),
    active: duration(daily.get(row.id)?.active_seconds),
    idle: duration(daily.get(row.id)?.idle_seconds),
    activity: row.last_seen
      ? new Date(row.last_seen).toLocaleString()
      : 'No device heartbeat',
    app: daily.get(row.id)?.top_application || '',
  }))
  const weeklyActivity = (resource.data.trend?.data || []).map((row) => ({
    day: row.date,
    active: row.active_seconds / 3600,
    idle: row.idle_seconds / 3600,
  }))
  const usage = resource.data.usage?.data
  const categories = (usage?.items || []).map((row) => ({
    name: row.category,
    value: row.percentage ?? 0,
    color: categoryColors[row.category],
    time: duration(row.seconds),
  }))
  const rawApps = resource.data.apps?.data || []
  const maximum = Math.max(1, ...rawApps.map((row) => row.seconds))
  const applications = rawApps.map((row) => ({
    name: row.application_name,
    category: row.category || 'Unclassified',
    time: duration(row.seconds),
    percent: (row.seconds * 100) / maximum,
  }))
  const departments = (resource.data.departments?.data || []).map((row) => ({
    name: row.name,
    activeSeconds: row.active_seconds,
  }))
  const departmentMaximum = Math.max(
    1,
    ...departments.map((row) => row.activeSeconds),
  )
  const filtered = employees.filter(
    (employee) =>
      `${employee.name} ${employee.email} ${employee.department}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === 'All' || employee.status === status),
  )
  const chartData = weeklyActivity

  return (
    <div className="dashboard-shell">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNotice={setNotice}
      />

      <div className="dashboard-workspace" id="overview">
        <PageHeader
          title="Dashboard"
          subtitle="Overview of employee activity today"
          search={{
            label: 'Search employees',
            value: search,
            onChange: setSearch,
          }}
          date="Today"
          onMenuOpen={() => setMenuOpen(true)}
        />

        <main id="main-content" tabIndex={-1} className="dashboard-content">
          <div className="preview-notice">
            <span>
              <span className="preview-dot" />
              {resource.loading
                ? 'Loading database records…'
                : resource.loadedAt
                  ? `Updated ${resource.loadedAt.toLocaleTimeString()}`
                  : 'Data unavailable'}
            </span>
            <button type="button" onClick={resource.reload}>
              Refresh data <ArrowRight size={13} className="inline" />
            </button>
          </div>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          {Object.entries(resource.errors).map(([name, error]) => (
            <p
              key={name}
              role="alert"
              className="my-3 rounded-xl bg-red-50 p-3 text-sm text-error"
            >
              {name}: {error}
            </p>
          ))}
          <section className="summary-grid" aria-label="Employee overview">
            {[
              {
                title: 'Total Employees',
                value: stats?.total_employees ?? '—',
                Icon: UsersRound,
                detail: 'All registered team members',
                extra: stats
                  ? `${stats.paused} paused · ${stats.unknown} unknown`
                  : 'Not available',
                tone: '',
              },
              {
                title: 'Active Now',
                value: stats?.active ?? '—',
                Icon: Zap,
                detail: 'Not available',
                tone: 'green',
              },
              {
                title: 'Idle Now',
                value: stats?.idle ?? '—',
                Icon: Hourglass,
                detail: 'Not available',
                tone: 'orange',
              },
              {
                title: 'Offline',
                value: stats?.offline ?? '—',
                Icon: CloudOff,
                detail: 'Not available',
                tone: 'gray',
              },
            ].map(({ title, value, Icon, detail, extra, tone }) => (
              <article className="summary-card" key={title}>
                <div className="summary-top">
                  <h2>{title}</h2>
                  <span>
                    <Icon size={21} />
                  </span>
                </div>
                <strong className="summary-value">{value}</strong>
                <div className={`summary-detail ${tone}`}>
                  {tone && <i />}
                  {detail}
                  {extra && <span>{extra}</span>}
                </div>
              </article>
            ))}
          </section>

          <div className="dashboard-columns">
            <section className="dashboard-panel activity-panel" id="activity">
              <PanelHeading
                title="Active vs Idle Time"
                subtitle="Aggregated hours per working day"
              >
                <div className="chart-controls">
                  <span className="chart-key">
                    <i />
                    Active
                  </span>
                  <span className="chart-key idle-key">
                    <i />
                    Idle
                  </span>
                  <label className="period-select">
                    <select
                      aria-label="Activity period"
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                    >
                      <option>This week</option>
                      <option>Last week</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                </div>
              </PanelHeading>
              <div
                className="bar-chart"
                role="img"
                aria-label={`Active versus idle hours for ${period.toLowerCase()}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    barGap={6}
                    margin={{ top: 18, right: 8, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid vertical={false} stroke="#edf1f7" />
                    <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#71778c', fontSize: 12 }}
                      dy={8}
                    />
                    <YAxis
                      domain={[0, 'auto']}
                      tickFormatter={(value) => `${value}h`}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#b2b8c6', fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ fill: '#eff6ff' }}
                      formatter={(value, name) => [`${value}h`, name]}
                    />
                    <Bar
                      dataKey="active"
                      name="Active"
                      fill="#2563eb"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={22}
                    >
                      {chartData.map((day, index) => (
                        <Cell
                          key={day.day}
                          fill={index > 4 ? '#9eb9fa' : '#2563eb'}
                        />
                      ))}
                    </Bar>
                    <Bar
                      dataKey="idle"
                      name="Idle"
                      fill="#f59e0b"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="dashboard-panel usage-panel" id="applications">
              <PanelHeading
                title="Application Usage"
                subtitle="Category classification metrics"
              >
                <span className="small-badge">Today</span>
              </PanelHeading>
              <div
                className="donut-chart"
                role="img"
                aria-label="No application usage data loaded"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categories}
                      dataKey="value"
                      innerRadius="70%"
                      outerRadius="96%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                    >
                      {categories.map((category) => (
                        <Cell key={category.name} fill={category.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-label">
                  <strong>{duration(usage?.total_application_seconds)}</strong>
                  <span>Recorded application time</span>
                </div>
              </div>
              <div className="usage-legend">
                {categories.map((category) => (
                  <div key={category.name}>
                    <span>
                      <i style={{ background: category.color }} />
                      {category.name}
                    </span>
                    <strong>{category.value}%</strong>
                    <small>{category.time}</small>
                  </div>
                ))}
              </div>
            </section>
            <section className="dashboard-panel employee-panel" id="employees">
              <PanelHeading title="Employee Live Status">
                <div className="employee-controls">
                  <span className="active-badge">
                    {stats?.active ?? '—'} Active
                  </span>
                  <label>
                    <span className="sr-only">Filter by status</span>
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      <option>All</option>
                      <option>Active</option>
                      <option>Idle</option>
                      <option>Offline</option>
                      <option>Paused</option>
                      <option>Unknown</option>
                    </select>
                  </label>
                </div>
              </PanelHeading>
              <div className="employee-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Status</th>
                      <th>Active</th>
                      <th>Idle</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((employee) => (
                      <tr key={employee.email}>
                        <td>
                          <div className="employee-identity">
                            <span className="initials">
                              {employee.name
                                .split(' ')
                                .map((name) => name[0])
                                .join('')}
                            </span>
                            <div>
                              <Link
                                to={
                                  '/activity-details?employeeId=' + employee.id
                                }
                              >
                                <strong>{employee.name}</strong>
                              </Link>
                              <small>{employee.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>{employee.department}</td>
                        <td>
                          <span
                            className={`status-badge ${employee.status.toLowerCase()}`}
                          >
                            <i />
                            {employee.status}
                          </span>
                        </td>
                        <td className="time-cell">{employee.active}</td>
                        <td
                          className={
                            employee.status === 'Idle' ? 'idle-time' : ''
                          }
                        >
                          {employee.idle}
                        </td>
                        <td>
                          <small>{employee.activity}</small>
                          <span className="activity-app">{employee.app}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p className="empty-state">
                    No employees match your search or status filter.
                  </p>
                )}
              </div>
              <p className="table-caption">
                Showing {filtered.length} of {employees.length}
                employees
              </p>
            </section>
            <section className="dashboard-panel top-apps-panel">
              <PanelHeading
                title="Top Applications Today"
                subtitle="Ranked by organization usage time"
              >
                <span className="small-badge">By usage</span>
              </PanelHeading>
              <div className="app-ranking">
                {applications.map((app, index) => {
                  const Icon = appIcons[index] || Code2
                  return (
                    <div key={app.name} className="ranked-app">
                      <div className="app-info">
                        <span className="app-rank">#{index + 1}</span>
                        <span className="app-icon">
                          <Icon size={17} />
                        </span>
                        <strong>{app.name}</strong>
                        <span className="app-category">{app.category}</span>
                        <b>{app.time}</b>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${app.percent}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
          <section
            className="dashboard-panel department-panel"
            id="departments"
          >
            <PanelHeading
              title="Department Activity"
              subtitle="Recorded active time by department; productivity scoring awaits an approved formula"
            >
              <span className="benchmark-label">Benchmark not configured</span>
            </PanelHeading>
            <div className="department-list">
              {departments.map((department) => (
                <div className="department-row" key={department.name}>
                  <strong>{department.name}</strong>
                  <div className="department-track">
                    <span
                      style={{
                        width: `${(department.activeSeconds * 100) / departmentMaximum}%`,
                      }}
                    >
                      {duration(department.activeSeconds)}
                    </span>
                  </div>
                  <b>{duration(department.activeSeconds)} active</b>
                </div>
              ))}
            </div>
          </section>
          <footer className="dashboard-footer">
            <Check size={13} />{' '}
            {resource.loading
              ? 'Loading records'
              : 'Database-backed activity · refreshes every 15 seconds'}
          </footer>
        </main>
      </div>
    </div>
  )
}
