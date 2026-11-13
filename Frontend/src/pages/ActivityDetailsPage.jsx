import useMediaQuery from '../hooks/useMediaQuery.js'
import { downloadCsv } from '../utils/download.js'
import Button from '../components/ui/Button.jsx'
import Heading from '../components/ui/SectionHeading.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  FileText,
  Globe,
  Info,
  MessageSquare,
  Monitor,
  Moon,
  Mouse,
  Palette,
  PlayCircle,
  Radio,
  Search,
  Shield,
  Timer,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import {
  Area,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Sidebar from '../components/layout/Sidebar.jsx'
import {
  activityEmployee as employee,
  activityApps,
  activityLogs,
  activityLogsCsv,
  activityTrend,
  filterActivityLogs,
  formatMinutes,
  hourlyActivity,
  timeDistribution,
} from '../data/activity.js'

const appIcons = [Code2, Globe, MessageSquare, UsersRound, Palette, PlayCircle]

export default function ActivityDetailsPage() {
  const printMode = useMediaQuery('print')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(8)
  const [interval, setInterval] = useState(2)
  const [period, setPeriod] = useState('This week')
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const filtered = filterActivityLogs(activityLogs, search, status)
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const shown = printMode
    ? filtered
    : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const currentInterval = hourlyActivity[interval]
  const trend =
    period === 'This week'
      ? activityTrend
      : activityTrend.map((day) => ({
          ...day,
          active: +(day.active * 0.92).toFixed(1),
          idle: +(day.idle * 1.08).toFixed(1),
        }))
  const exportCsv = () => {
    downloadCsv(activityLogsCsv(filtered), 'nimal-perera-activity-preview.csv')
    setNotice(`Exported ${filtered.length} preview activity records.`)
  }
  return (
    <div className="dashboard-shell activity-details">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNotice={setNotice}
      />
      <div className="dashboard-workspace">
        <PageHeader
          title="Activity Details"
          subtitle="Employee activity and application insights"
          search={{
            label: 'Search activity logs',
            value: search,
            onChange: (value) => {
              setSearch(value)
              setPage(1)
            },
          }}
          onMenuOpen={() => setMenuOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="dashboard-content activity-content"
        >
          <nav className="em-breadcrumb" aria-label="Breadcrumb">
            <Link to="/employees">Employees</Link>
            <ChevronRight size={12} />
            <span>{employee.name}</span>
            <ChevronRight size={12} />
            <span aria-current="page">Activity Details</span>
          </nav>
          <div className="management-title">
            <div>
              <h1>Employee Activity Details</h1>
              <p>
                Detailed telemetry and application workflow metrics for
                executive oversight.
              </p>
            </div>
            <div className="management-actions">
              <span className="em-button activity-date">
                <CalendarDays size={16} />
                Today
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.print()}
              >
                <FileText size={16} />
                Export PDF
              </Button>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                <Download size={16} />
                Export CSV
              </Button>
            </div>
          </div>
          <p className="em-preview-label">
            Sample employee · Illustrative telemetry only · Backend not
            connected
          </p>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          <section
            className="dashboard-panel activity-profile"
            aria-label="Employee profile"
          >
            <div className="profile-identity">
              <span className="profile-avatar">
                {employee.initials}
                <i />
              </span>
              <div>
                <div className="profile-name">
                  <h2>{employee.name}</h2>
                  <span className="management-status active">
                    <i />
                    ACTIVE
                  </span>
                  <small>Last activity: 2 minutes ago</small>
                </div>
                <p>
                  {employee.title}
                  <i />
                  {employee.id}
                  <i />
                  {employee.department}
                </p>
                <a href={`mailto:${employee.email}`}>{employee.email}</a>
              </div>
            </div>
            <div className="workstation-strip">
              <div>
                <Monitor size={18} />
                <span>
                  <small>WORKSTATION</small>
                  <strong>{employee.workstation}</strong>
                </span>
              </div>
              <div>
                <Radio size={18} />
                <span>
                  <small>TELEMETRY AGENT</small>
                  <strong className="connected-text">● Connected</strong>
                </span>
              </div>
              <div>
                <Clock3 size={18} />
                <span>
                  <small>ASSIGNED SHIFT</small>
                  <strong>09:00 - 17:30</strong>
                </span>
              </div>
            </div>
          </section>
          <section
            className="activity-stat-grid"
            aria-label="Daily activity metrics"
          >
            {[
              {
                title: 'Total Work Time',
                value: '7h 42m',
                detail: '+12m vs yesterday',
                Icon: Clock3,
                tone: 'blue',
              },
              {
                title: 'Active Time',
                value: '6h 18m',
                detail: '+4% vs yesterday',
                Icon: Timer,
                tone: 'green',
              },
              {
                title: 'Idle Time',
                value: '1h 24m',
                detail: '-8% vs yesterday',
                Icon: Moon,
                tone: 'orange',
              },
              {
                title: 'Productivity Score',
                value: '82%',
                detail: '+3% vs team avg',
                Icon: TrendingUp,
                tone: 'blue',
              },
            ].map(({ title, value, detail, Icon, tone }) => (
              <article className="dashboard-panel activity-stat" key={title}>
                <div>
                  <h2>{title}</h2>
                  <span className={`metric-icon ${tone}`}>
                    <Icon size={18} />
                  </span>
                </div>
                <strong>{value}</strong>
                <p className={tone === 'orange' ? 'orange' : 'green'}>
                  {tone === 'orange' ? (
                    <ArrowDown size={13} />
                  ) : (
                    <ArrowUp size={13} />
                  )}
                  {detail}
                </p>
              </article>
            ))}
            <article className="dashboard-panel activity-stat input-stat">
              <div>
                <h2>Input Events</h2>
                <span className="metric-icon">
                  <Mouse size={18} />
                </span>
              </div>
              <strong>
                12,480 <small>KEYS</small>
                <i />
                8,214 <small>CLICKS</small>
              </strong>
              <p>
                <TrendingUp size={13} />
                Normal continuous pace
              </p>
            </article>
          </section>
          <div className="activity-top-grid">
            <section className="dashboard-panel timeline-panel">
              <Heading
                title="Activity Timeline"
                subtitle="Hourly telemetry interval (8:00 AM - 6:00 PM)"
              >
                <div className="timeline-legend">
                  <span>
                    <i />
                    Active
                  </span>
                  <span>
                    <i />
                    Idle
                  </span>
                  <span>
                    <i />
                    Offline
                  </span>
                </div>
              </Heading>
              <div className="interval-readout" aria-live="polite">
                <strong>{currentInterval.hour}</strong>
                <span>Active {currentInterval.active}m</span>
                <span>Idle {currentInterval.idle}m</span>
              </div>
              <div className="hourly-timeline">
                {hourlyActivity.map((hour, index) => (
                  <button
                    key={hour.hour}
                    className={`hour-column ${interval === index ? 'selected' : ''}`}
                    onClick={() => setInterval(index)}
                    aria-label={`${hour.hour}: active ${hour.active} minutes, idle ${hour.idle} minutes, offline ${hour.offline} minutes`}
                    aria-pressed={interval === index}
                  >
                    <div className="hour-stack">
                      <span
                        className="hour-offline"
                        style={{ height: `${(hour.offline / 60) * 100}%` }}
                      />
                      <span
                        className="hour-idle"
                        style={{ height: `${(hour.idle / 60) * 100}%` }}
                      />
                      <span
                        className="hour-active"
                        style={{ height: `${(hour.active / 60) * 100}%` }}
                      />
                    </div>
                    <small>{hour.hour}</small>
                  </button>
                ))}
              </div>
              <div className="timeline-insights">
                <span>
                  <CheckCircle2 size={14} />
                  Core active interval: 09:12 - 12:04
                </span>
                <span>Peak input: 10:24 AM (82 keystrokes/min)</span>
              </div>
            </section>
            <section className="dashboard-panel distribution-panel">
              <Heading
                title="Time Distribution"
                subtitle="Productivity classification ratio"
              />
              <div className="distribution-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={timeDistribution}
                      dataKey="minutes"
                      innerRadius="73%"
                      outerRadius="98%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                    >
                      {timeDistribution.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatMinutes(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  <strong>7h 42m</strong>
                  <small>TOTAL TRACKED</small>
                </div>
              </div>
              <div className="distribution-legend">
                {timeDistribution.map((item) => (
                  <div key={item.name}>
                    <i style={{ background: item.color }} />
                    <span>{item.name}</span>
                    <strong>{formatMinutes(item.minutes)}</strong>
                    <small>{Math.round((item.minutes / 462) * 100)}%</small>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="activity-middle-grid">
            <section className="dashboard-panel activity-apps">
              <Heading
                title="Application Usage"
                subtitle="Ranked by continuous duration"
              >
                <span className="small-badge">TOP 6 APPS</span>
              </Heading>
              <div className="activity-app-list">
                {activityApps.map((app, index) => {
                  const Icon = appIcons[index]
                  return (
                    <div key={app.name}>
                      <div className="activity-app-info">
                        <span className="app-icon" style={{ color: app.color }}>
                          <Icon size={17} />
                        </span>
                        <strong>{app.name}</strong>
                        <span
                          className={`classification ${app.category.toLowerCase()}`}
                        >
                          {app.category}
                        </span>
                        <b>{formatMinutes(app.minutes)}</b>
                      </div>
                      <div className="progress-track">
                        <span
                          style={{
                            width: `${(app.minutes / 462) * 100}%`,
                            background: app.color,
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="dashboard-panel weekly-activity">
              <Heading
                title="Weekly Activity Trend"
                subtitle="Active vs idle historical progression"
              >
                <select
                  aria-label="Weekly activity period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option>This week</option>
                  <option>Last week</option>
                </select>
              </Heading>
              <div className="activity-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={trend}
                    margin={{ top: 30, right: 18, bottom: 10, left: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="activityTrendFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#2563eb"
                          stopOpacity={0.15}
                        />
                        <stop
                          offset="100%"
                          stopColor="#2563eb"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="#dce5f6"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: '#535b70', fontSize: 10 }}
                      dy={14}
                    />
                    <YAxis hide domain={[0, 8]} />
                    <Tooltip formatter={(value, name) => [`${value}h`, name]} />
                    <Area
                      type="monotone"
                      dataKey="active"
                      name="Active"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      fill="url(#activityTrendFill)"
                      dot={{ r: 3, fill: 'white', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="idle"
                      name="Idle"
                      stroke="#e68a00"
                      strokeDasharray="4 3"
                      dot={{ r: 2, fill: 'white' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="weekly-trend-footer">
                <span>
                  <i />
                  Active Hours (Avg:{' '}
                  {(
                    trend.reduce((sum, day) => sum + day.active, 0) / 7
                  ).toFixed(1)}
                  h)
                </span>
                <span>
                  <i />
                  Idle Hours (Avg:{' '}
                  {(trend.reduce((sum, day) => sum + day.idle, 0) / 7).toFixed(
                    1,
                  )}
                  h)
                </span>
                <strong>
                  <TrendingUp size={14} />
                  +8.2% vs last week
                </strong>
              </div>
            </section>
          </div>
          <section className="dashboard-panel activity-log-panel">
            <Heading
              title="Activity Log"
              subtitle="Telemetry timeline records in 15-minute intervals"
            >
              <div className="log-filters">
                <label>
                  <Search size={16} />
                  <input
                    aria-label="Filter activity logs"
                    placeholder="Filter logs…"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                  />
                </label>
                <select
                  aria-label="Filter log status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">Status: All</option>
                  {['Active', 'Neutral', 'Idle'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            </Heading>
            <div className="activity-log-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      'Time Range',
                      'Status',
                      'Active Application',
                      'Activity Context',
                      'Mouse Events',
                      'Keystrokes',
                      'Duration',
                    ].map((title) => (
                      <th key={title}>{title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr
                      key={row.id}
                      className={row.status === 'Idle' ? 'idle-log' : ''}
                    >
                      <td>{row.range}</td>
                      <td>
                        <span
                          className={`log-status ${row.status.toLowerCase()}`}
                        >
                          <i />
                          {row.status}
                        </span>
                      </td>
                      <td>
                        <div className="log-app">
                          <Code2 size={16} />
                          {row.app}
                        </div>
                      </td>
                      <td>{row.context}</td>
                      <td>{row.mouse.toLocaleString()}</td>
                      <td>
                        <strong>{row.keys.toLocaleString()}</strong>
                      </td>
                      <td>{row.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && (
                <div className="empty-state">
                  No matching activity records. Try another search or status.
                </div>
              )}
            </div>
            <div className="management-pagination">
              <p>
                Showing{' '}
                <strong>
                  {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}
                </strong>{' '}
                to{' '}
                <strong>
                  {Math.min(currentPage * pageSize, filtered.length)}
                </strong>{' '}
                of <strong>{filtered.length}</strong> entries
              </p>
              <div>
                <label>
                  Rows per page:{' '}
                  <select
                    aria-label="Activity rows per page"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value))
                      setPage(1)
                    }}
                  >
                    {[8, 16, 36].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <nav aria-label="Activity log pages">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Prev
                  </button>
                  {Array.from({ length: pages }, (_, index) => (
                    <button
                      key={index}
                      className={currentPage === index + 1 ? 'current' : ''}
                      aria-current={
                        currentPage === index + 1 ? 'page' : undefined
                      }
                      onClick={() => setPage(index + 1)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </button>
                </nav>
              </div>
            </div>
          </section>
          <footer className="activity-privacy">
            <Shield size={22} />
            <p>
              <strong>Data Privacy</strong> · This preview displays aggregate
              input counts and sample application durations. It does not capture
              keystroke content, screenshots or messages.
            </p>
            <button onClick={() => setPrivacyOpen((value) => !value)}>
              Privacy details <ChevronRight size={14} />
            </button>
          </footer>
          {privacyOpen && (
            <div className="dashboard-panel privacy-details">
              <Info size={18} />
              <p>
                All telemetry on this page is illustrative. No monitoring agent
                or backend is connected. A production integration must obtain
                employee consent and define retention and access policies before
                collecting activity data.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
