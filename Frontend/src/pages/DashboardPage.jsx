import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, CloudOff, Code2, Globe, Hourglass, Menu, MessageSquare, Palette, Search, Sheet, UserRound, UsersRound, X, Zap } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Sidebar from '../components/layout/Sidebar.jsx'
import { applications, departments, employees, weeklyActivity } from '../data/dashboard.js'

const categories = [
  { name: 'Productive', value: 62, color: '#00652b', time: '4h 46m' },
  { name: 'Neutral', value: 24, color: '#2563eb', time: '1h 51m' },
  { name: 'Unproductive', value: 14, color: '#c5161d', time: '1h 05m' },
]
const appIcons = [Code2, Globe, MessageSquare, Sheet, Palette]

function PanelHeading({ title, subtitle, children }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children}</div>
}

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('This week')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('All')
  const filtered = employees.filter((employee) => `${employee.name} ${employee.email} ${employee.department}`.toLowerCase().includes(search.toLowerCase()) && (status === 'All' || employee.status === status))
  const chartData = period === 'This week' ? weeklyActivity : weeklyActivity.map((day) => ({ ...day, active: +(day.active * 0.88).toFixed(1), idle: +(day.idle * 1.2).toFixed(1) }))

  return (
    <div className="dashboard-shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onNotice={setNotice} />

      <div className="dashboard-workspace" id="overview">
        <header className="dashboard-header">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu /></button>
          <div className="page-title"><h1>Dashboard</h1><p>Overview of employee activity today</p></div>
          <div className="header-actions">
            <label className="employee-search"><Search size={17} /><input aria-label="Search employees" placeholder="Search employees…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <span className="date-badge"><CalendarDays size={17} />Today</span>
            <button className="icon-button notifications-button" aria-label="Notifications" onClick={() => setNotice('You’re all caught up. No new notifications in this preview.')}><Bell size={19} /><span /></button>
            <button className="account-avatar" aria-label="View profile" onClick={() => setNotice('Admin preview · Administrator. Live account information is not connected.')}><UserRound size={18} /></button>
          </div>
        </header>

        <main className="dashboard-content">
          <div className="preview-notice"><span><span className="preview-dot" />Preview data · Backend not connected</span><Link to="/login">Back to login <ArrowRight size={13} /></Link></div>
          {notice && <div className="dashboard-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={17} /></button></div>}
          <section className="summary-grid" aria-label="Employee overview">
            {[
              { title: 'Total Employees', value: '128', Icon: UsersRound, detail: 'All registered team members', extra: '+2 this month', tone: '' },
              { title: 'Active Now', value: '94', Icon: Zap, detail: '+6% vs yesterday', tone: 'green' },
              { title: 'Idle Now', value: '21', Icon: Hourglass, detail: 'Below idle threshold', tone: 'orange' },
              { title: 'Offline', value: '13', Icon: CloudOff, detail: 'Not logged in', tone: 'gray' },
            ].map(({ title, value, Icon, detail, extra, tone }) => <article className="summary-card" key={title}><div className="summary-top"><h2>{title}</h2><span><Icon size={21} /></span></div><strong className="summary-value">{value}</strong><div className={`summary-detail ${tone}`}>{tone && <i />}{detail}{extra && <span>{extra}</span>}</div></article>)}
          </section>

          <div className="dashboard-columns">
            <section className="dashboard-panel activity-panel" id="activity">
              <PanelHeading title="Active vs Idle Time" subtitle="Aggregated hours per working day"><div className="chart-controls"><span className="chart-key"><i />Active</span><span className="chart-key idle-key"><i />Idle</span><label className="period-select"><select aria-label="Activity period" value={period} onChange={(event) => setPeriod(event.target.value)}><option>This week</option><option>Last week</option></select><ChevronDown size={13} /></label></div></PanelHeading>
              <div className="bar-chart" role="img" aria-label={`Active versus idle hours for ${period.toLowerCase()}`}><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} barGap={6} margin={{ top: 18, right: 8, bottom: 0, left: -20 }}><CartesianGrid vertical={false} stroke="#edf1f7" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#71778c', fontSize: 12 }} dy={8} /><YAxis domain={[0, 8]} ticks={[0, 2, 4, 6, 8]} tickFormatter={(value) => `${value}h`} axisLine={false} tickLine={false} tick={{ fill: '#b2b8c6', fontSize: 11 }} /><Tooltip cursor={{ fill: '#eff6ff' }} formatter={(value, name) => [`${value}h`, name]} /><Bar dataKey="active" name="Active" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={22}>{chartData.map((day, index) => <Cell key={day.day} fill={index > 4 ? '#9eb9fa' : '#2563eb'} />)}</Bar><Bar dataKey="idle" name="Idle" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer></div>
            </section>
            <section className="dashboard-panel usage-panel" id="applications">
              <PanelHeading title="Application Usage" subtitle="Category classification metrics"><span className="small-badge">Today</span></PanelHeading>
              <div className="donut-chart" role="img" aria-label="Application usage: 62 percent productive, 24 percent neutral, 14 percent unproductive"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" innerRadius="70%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="none">{categories.map((category) => <Cell key={category.name} fill={category.color} />)}</Pie></PieChart></ResponsiveContainer><div className="donut-label"><strong>7h 42m</strong><span>Daily avg / user</span></div></div>
              <div className="usage-legend">{categories.map((category) => <div key={category.name}><span><i style={{ background: category.color }} />{category.name}</span><strong>{category.value}%</strong><small>{category.time}</small></div>)}</div>
            </section>
            <section className="dashboard-panel employee-panel" id="employees">
              <PanelHeading title="Employee Live Status"><div className="employee-controls"><span className="active-badge">94 Active</span><label><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option><option>Active</option><option>Idle</option><option>Offline</option></select></label></div></PanelHeading>
              <div className="employee-table-scroll"><table><thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>Active</th><th>Idle</th><th>Last activity</th></tr></thead><tbody>{filtered.map((employee) => <tr key={employee.email}><td><div className="employee-identity"><span className="initials">{employee.name.split(' ').map((name) => name[0]).join('')}</span><div><strong>{employee.name}</strong><small>{employee.email}</small></div></div></td><td>{employee.department}</td><td><span className={`status-badge ${employee.status.toLowerCase()}`}><i />{employee.status}</span></td><td className="time-cell">{employee.active}</td><td className={employee.status === 'Idle' ? 'idle-time' : ''}>{employee.idle}</td><td><small>{employee.activity}</small><span className="activity-app">{employee.app}</span></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="empty-state">No employees match your search or status filter.</p>}</div>
              <p className="table-caption">Showing {filtered.length} of {employees.length} preview employees</p>
            </section>
            <section className="dashboard-panel top-apps-panel"><PanelHeading title="Top Applications Today" subtitle="Ranked by organization usage time"><span className="small-badge">By usage</span></PanelHeading><div className="app-ranking">{applications.map((app, index) => { const Icon = appIcons[index]; return <div key={app.name} className="ranked-app"><div className="app-info"><span className="app-rank">#{index + 1}</span><span className="app-icon"><Icon size={17} /></span><strong>{app.name}</strong><span className="app-category">{app.category}</span><b>{app.time}</b></div><div className="progress-track"><span style={{ width: `${app.percent}%` }} /></div></div> })}</div></section>
          </div>
          <section className="dashboard-panel department-panel" id="departments"><PanelHeading title="Department Productivity" subtitle="Average productive time index across teams relative to standard working quota"><span className="benchmark-label">┄ Org Benchmark: 75%</span></PanelHeading><div className="department-list">{departments.map((department) => <div className="department-row" key={department.name}><strong>{department.name}</strong><div className="department-track"><span style={{ width: `${department.value}%` }}>{department.value}%</span><i title="Organization benchmark: 75%" /></div><b>{department.hours}h avg</b></div>)}</div></section>
          <footer className="dashboard-footer"><Check size={13} /> Design preview · All metrics are sample data</footer>
        </main>
      </div>
    </div>
  )
}
