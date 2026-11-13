import { downloadCsv } from '../utils/download.js'
import Button from '../components/ui/Button.jsx'
import Heading from '../components/ui/SectionHeading.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Code2,
  Download,
  Globe,
  Grid3X3,
  Info,
  MessageSquare,
  Pencil,
  PlaySquare,
  Search,
  Share2,
  ShieldCheck,
  Sheet,
  TrendingUp,
  TriangleAlert,
  UsersRound,
  Video,
} from 'lucide-react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Sidebar from '../components/layout/Sidebar.jsx'
import {
  applicationCategories,
  applicationColors,
  formatUsageTime,
  getCategoryTotals,
  getUsageTrend,
  summarizeApplications,
  trackedApplications,
  usageCsv,
  usageDepartments,
  usageEmployees,
} from '../data/applicationUsage.js'

const iconMap = {
  vscode: Code2,
  chrome: Globe,
  slack: MessageSquare,
  teams: UsersRound,
  excel: Sheet,
  figma: Grid3X3,
  zoom: Video,
  notion: Grid3X3,
  youtube: PlaySquare,
  facebook: Share2,
}
const categoryStyles = {
  Productive: 'bg-success/10 text-success-strong',
  Neutral: 'bg-primary/10 text-primary',
  Unproductive: 'bg-error/10 text-error',
}
const control =
  'rounded-lg border border-transparent bg-soft px-3 py-2 text-xs text-ink outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10'
const panel =
  'rounded-2xl border border-line/60 bg-white p-5 shadow-card sm:p-6'

function CategoryBadge({ category }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${categoryStyles[category]}`}
    >
      <i className="size-1.5 rounded-full bg-current" />
      {category}
    </span>
  )
}
function Legend() {
  return (
    <div className="flex flex-wrap gap-4">
      {applicationCategories.map((category) => (
        <span
          key={category}
          className="flex items-center gap-1.5 text-[10px] text-ink"
        >
          <i
            className="size-2.5 rounded-full"
            style={{ background: applicationColors[category] }}
          />
          {category}
        </span>
      ))}
    </div>
  )
}

export default function ApplicationUsagePage() {
  const [apps, setApps] = useState(trackedApplications)
  const [filters, setFilters] = useState({
    period: 'today',
    department: '',
    employee: '',
    category: '',
  })
  const [search, setSearch] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(8)
  const [days, setDays] = useState(7)
  const [editing, setEditing] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const summary = summarizeApplications(apps, filters)
  const categories = getCategoryTotals(summary)
  const total = summary.reduce((sum, app) => sum + app.totalMinutes, 0)
  const cohort = summary[0]?.cohort || 0
  const average = Math.round(total / Math.max(1, cohort))
  const productive = total ? (categories[0].minutes / total) * 100 : 0
  const unproductive = total ? (categories[2].minutes / total) * 100 : 0
  const filtered = summary.filter((app) =>
    `${app.name} ${app.description} ${app.category}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )
  const employeeOptions = usageEmployees.filter(
    (employee) =>
      (!filters.department || employee.department === filters.department) &&
      employee.name.toLowerCase().includes(employeeSearch.trim().toLowerCase()),
  )
  const trend = getUsageTrend(categories, cohort, days)
  const changeFilter = (field, value) => {
    setFilters((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'department' ? { employee: '' } : {}),
    }))
    setPage(1)
    setEditing(null)
  }
  const changeCategory = (id, category) => {
    setApps((previous) =>
      previous.map((app) => (app.id === id ? { ...app, category } : app)),
    )
    setNotice(
      'Application classification updated in this preview. Charts and totals have been recalculated.',
    )
  }
  const exportCsv = () => {
    downloadCsv(
      usageCsv(filtered),
      `application-usage-${filters.period}-preview.csv`,
    )
    setNotice(
      `Exported ${filtered.length} applications matching the current filters.`,
    )
  }
  return (
    <div className="dashboard-shell">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNotice={setNotice}
      />
      <div className="dashboard-workspace">
        <PageHeader
          title="Application Usage"
          subtitle="Monitor software utilization across teams"
          search={{
            label: 'Search employee options',
            value: employeeSearch,
            onChange: setEmployeeSearch,
          }}
          date={filters.period === 'today' ? 'Today' : 'Yesterday'}
          onMenuOpen={() => setMenuOpen(true)}
        />
        <main id="main-content" tabIndex={-1} className="dashboard-content">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3">
            <nav
              className="flex flex-wrap items-center gap-1 text-[11px] text-muted"
              aria-label="Breadcrumb"
            >
              <Link to="/dashboard" className="hover:text-primary">
                Workforce Analytics
              </Link>
              <ChevronRight size={12} />
              <Link to="/activity-details" className="hover:text-primary">
                Activity Details
              </Link>
              <ChevronRight size={12} />
              <span className="text-ink" aria-current="page">
                Application Telemetry
              </span>
            </nav>
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <i className="size-1.5 rounded-full bg-warning" />
              Preview data · {usageEmployees.length} sample employees
            </span>
          </div>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          <section
            className={`${panel} flex flex-wrap items-center gap-2.5 !p-4`}
            aria-label="Application usage filters"
          >
            <label className="flex items-center gap-1 rounded-lg bg-soft pl-3 text-primary">
              <CalendarDays size={16} />
              <span className="sr-only">Usage date</span>
              <select
                className={control}
                value={filters.period}
                onChange={(event) => changeFilter('period', event.target.value)}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Department</span>
              <select
                className={control}
                value={filters.department}
                onChange={(event) =>
                  changeFilter('department', event.target.value)
                }
              >
                <option value="">Department: All</option>
                {usageDepartments.map((department) => (
                  <option key={department}>{department}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Employee</span>
              <select
                className={`${control} max-w-48`}
                value={filters.employee}
                onChange={(event) =>
                  changeFilter('employee', event.target.value)
                }
              >
                <option value="">Employee: All</option>
                {filters.employee &&
                  !employeeOptions.some(
                    (employee) => employee.id === filters.employee,
                  ) && (
                    <option value={filters.employee}>
                      {
                        usageEmployees.find(
                          (employee) => employee.id === filters.employee,
                        )?.name
                      }
                    </option>
                  )}
                {employeeOptions.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Category</span>
              <select
                className={control}
                value={filters.category}
                onChange={(event) =>
                  changeFilter('category', event.target.value)
                }
              >
                <option value="">Category: All</option>
                {applicationCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <button
              className="px-2 py-2 text-xs font-medium text-primary hover:text-blue-800"
              onClick={() => {
                setFilters({
                  period: 'today',
                  department: '',
                  employee: '',
                  category: '',
                })
                setSearch('')
                setEmployeeSearch('')
                setPage(1)
                setEditing(null)
              }}
            >
              Reset
            </button>
            <Button
              type="button"
              variant="secondary"
              className="sm:ml-auto"
              onClick={exportCsv}
            >
              <Download size={15} />
              Export CSV
            </Button>
          </section>
          {employeeSearch && (
            <p role="status" className="mt-2 text-xs text-muted">
              {employeeOptions.length} matching employee
              {employeeOptions.length === 1 ? '' : 's'} in the Employee filter.
            </p>
          )}
          <section
            className="my-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Application usage overview"
          >
            {[
              {
                label: 'Total Apps Tracked',
                value: summary.length,
                detail: 'Applications in selected scope',
                Icon: Grid3X3,
                tone: 'text-primary bg-primary/10',
              },
              {
                label: 'Most Used App',
                value: summary[0]?.shortName || summary[0]?.name || 'No data',
                detail: `${formatUsageTime(summary[0]?.averageMinutes || 0)} avg per user`,
                Icon: Globe,
                tone: 'text-primary bg-primary/10',
              },
              {
                label: 'Productive Time',
                value: `${Math.round(productive)}%`,
                detail: `${formatUsageTime(categories[0].minutes)} total productive time`,
                Icon: TrendingUp,
                tone: 'text-success-strong bg-success/10',
                valueTone: 'text-success-strong',
              },
              {
                label: 'Unproductive Time',
                value: `${Math.round(unproductive)}%`,
                detail: `${formatUsageTime(categories[2].minutes)} total unproductive time`,
                Icon: TriangleAlert,
                tone: 'text-error bg-error/10',
                valueTone: 'text-error',
              },
            ].map(({ label, value, detail, Icon, tone, valueTone }) => (
              <article
                className={`${panel} flex min-h-40 flex-col`}
                key={label}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-xs font-medium text-muted">{label}</h2>
                    <strong
                      className={`mt-3 block break-words text-2xl font-bold tracking-tight ${valueTone || 'text-sidebar'}`}
                    >
                      {value}
                    </strong>
                  </div>
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
                  >
                    <Icon size={20} />
                  </span>
                </div>
                <p className="mt-auto pt-5 text-[11px] text-muted">{detail}</p>
              </article>
            ))}
          </section>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2.08fr)_minmax(0,1fr)]">
            <section className={panel}>
              <Heading
                title="Top 10 Applications by Usage"
                subtitle={`Ranked by total organization hours logged ${filters.period}`}
              >
                <Legend />
              </Heading>
              <div className="mt-6 space-y-4">
                {summary.slice(0, 10).map((app) => (
                  <div
                    key={app.id}
                    className="grid grid-cols-[90px_minmax(0,1fr)_60px] items-center gap-3 sm:grid-cols-[110px_minmax(0,1fr)_72px]"
                  >
                    <span
                      className="truncate text-xs text-ink"
                      title={app.name}
                    >
                      {app.shortName || app.name}
                    </span>
                    <div className="h-3.5 overflow-hidden rounded-full bg-soft">
                      <div
                        className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                        style={{
                          width: `${(app.totalMinutes / Math.max(1, summary[0].totalMinutes)) * 100}%`,
                          background: applicationColors[app.category],
                        }}
                      />
                    </div>
                    <strong className="text-right text-[11px] font-medium tabular-nums">
                      {(app.totalMinutes / 60).toFixed(1)} hrs
                    </strong>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex justify-between pl-[102px] pr-[72px] text-[9px] text-muted sm:pl-[122px] sm:pr-[84px]">
                <span>0 hrs</span>
                <span>
                  {((summary[0]?.totalMinutes || 0) / 120).toFixed(1)} hrs
                </span>
                <span>
                  {((summary[0]?.totalMinutes || 0) / 60).toFixed(1)} hrs max
                </span>
              </div>
            </section>
            <section className={panel}>
              <Heading
                title="Category Breakdown"
                subtitle="Productivity classification ratio"
              />
              <div className="relative mx-auto my-8 size-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categories}
                      dataKey="minutes"
                      innerRadius="72%"
                      outerRadius="98%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                    >
                      {categories.map((category) => (
                        <Cell key={category.name} fill={category.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatUsageTime(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <small className="text-[9px] font-medium tracking-wide text-muted">
                    AVG PER USER
                  </small>
                  <strong className="text-xl font-bold tracking-tight">
                    {formatUsageTime(average)}
                  </strong>
                  <span className="mt-1 text-[10px] text-success-strong">
                    {cohort} employees in scope
                  </span>
                </div>
              </div>
              <div className="space-y-2.5">
                {categories.map((category) => (
                  <div
                    key={category.name}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs"
                  >
                    <i
                      className="size-2.5 rounded-full"
                      style={{ background: category.color }}
                    />
                    <span className="text-ink">{category.name}</span>
                    <span className="ml-auto text-[10px] text-muted">
                      {formatUsageTime(category.minutes)}
                    </span>
                    <strong
                      className="w-8 text-right"
                      style={{ color: category.color }}
                    >
                      {total ? Math.round((category.minutes / total) * 100) : 0}
                      %
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className={`${panel} mt-6`}>
            <Heading
              title="Usage Trend"
              subtitle="Illustrative daily average hours across productivity categories"
            >
              <div className="flex flex-wrap items-center gap-4">
                <Legend />
                <select
                  className={control}
                  aria-label="Usage trend period"
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                >
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                </select>
              </div>
            </Heading>
            <div className="mt-6 h-72 w-full sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={trend}
                  margin={{ top: 14, left: -18, right: 10, bottom: 5 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#e2e8f0"
                    strokeDasharray="4 5"
                  />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#73788d', fontSize: 10 }}
                    dy={10}
                    minTickGap={18}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#73788d', fontSize: 10 }}
                    tickFormatter={(value) => `${value}h`}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      `${Number(value).toFixed(2)}h`,
                      name,
                    ]}
                  />
                  {categories.map((category) => (
                    <Line
                      key={category.name}
                      type="monotone"
                      dataKey={category.name}
                      stroke={category.color}
                      strokeWidth={category.name === 'Productive' ? 3 : 2}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="mt-6 overflow-hidden rounded-2xl border border-line/60 bg-white shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">
                  Tracked Applications
                </h2>
                <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                  {summary.length} apps
                </span>
              </div>
              <label className="flex w-full items-center gap-2 rounded-lg border border-line/60 bg-slate-50 px-3 py-2 text-muted focus-within:ring-4 focus-within:ring-primary/10 sm:w-72">
                <Search size={16} />
                <input
                  className="w-full min-w-0 bg-transparent text-xs outline-none"
                  placeholder="Search applications…"
                  aria-label="Search applications"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-xs">
                <thead className="bg-soft text-[10px] uppercase tracking-wide text-muted">
                  <tr>
                    {[
                      'Application',
                      'Category',
                      'Total Time',
                      'Avg per Employee',
                      'Users',
                      'Usage Share',
                      'Action',
                    ].map((label) => (
                      <th key={label} className="px-6 py-4 font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {visible.map((app) => {
                    const Icon = iconMap[app.id]
                    return (
                      <tr
                        key={app.id}
                        className="transition-colors hover:bg-slate-50/80"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-soft text-primary">
                              <Icon size={17} />
                            </span>
                            <div>
                              <strong className="block font-medium text-sidebar">
                                {app.name}
                              </strong>
                              <small className="mt-0.5 block max-w-40 text-[10px] text-muted">
                                {app.description}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {editing === app.id ? (
                            <select
                              autoFocus
                              aria-label={`Classification for ${app.name}`}
                              className={`${control} max-w-36`}
                              value={app.category}
                              onChange={(event) =>
                                changeCategory(app.id, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') setEditing(null)
                              }}
                            >
                              {applicationCategories.map((category) => (
                                <option key={category}>{category}</option>
                              ))}
                            </select>
                          ) : (
                            <CategoryBadge category={app.category} />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 font-medium tabular-nums">
                          {formatUsageTime(app.totalMinutes)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-muted-strong tabular-nums">
                          {formatUsageTime(app.averageMinutes)}
                        </td>
                        <td className="px-6 py-4 text-muted-strong">
                          {app.users} / {app.cohort}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-soft">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${app.share}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted">
                              {app.share.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            className="flex items-center gap-1 whitespace-nowrap font-medium text-primary hover:text-blue-800"
                            onClick={() =>
                              setEditing(editing === app.id ? null : app.id)
                            }
                            aria-expanded={editing === app.id}
                          >
                            {editing === app.id ? (
                              <>
                                <Check size={14} />
                                Done
                              </>
                            ) : (
                              <>
                                <Pencil size={14} />
                                Change
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {visible.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                  <Search size={24} className="text-muted" />
                  <h3 className="font-semibold">No applications found</h3>
                  <p className="text-xs text-muted">
                    Try another search or reset the filters.
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50/60 px-6 py-5 text-xs text-muted">
              <p>
                Showing{' '}
                <strong className="font-medium text-ink">
                  {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}
                </strong>{' '}
                to{' '}
                <strong className="font-medium text-ink">
                  {Math.min(currentPage * pageSize, filtered.length)}
                </strong>{' '}
                of {filtered.length} applications
              </p>
              <label className="flex items-center gap-2">
                Rows per page:
                <select
                  className={control}
                  aria-label="Applications per page"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                >
                  {[5, 8, 10].map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </label>
              <nav
                className="flex items-center gap-1"
                aria-label="Application pages"
              >
                <button
                  className="rounded-lg px-2 py-2 hover:bg-soft disabled:cursor-default disabled:opacity-35"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Prev
                </button>
                {Array.from({ length: pages }, (_, index) => (
                  <button
                    key={index}
                    className={`size-8 rounded-lg ${currentPage === index + 1 ? 'bg-primary text-white' : 'hover:bg-soft'}`}
                    aria-current={
                      currentPage === index + 1 ? 'page' : undefined
                    }
                    onClick={() => setPage(index + 1)}
                  >
                    {index + 1}
                  </button>
                ))}
                <button
                  className="rounded-lg px-2 py-2 hover:bg-soft disabled:cursor-default disabled:opacity-35"
                  disabled={currentPage === pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </nav>
            </div>
          </section>
          <footer className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/5 bg-soft p-4 text-xs leading-relaxed text-muted-strong">
            <ShieldCheck size={22} className="shrink-0 text-primary" />
            <p className="min-w-48 flex-1">
              Preview telemetry only. No screen contents, keystrokes or live
              application usage are captured. Classification changes reset on
              page reload.
            </p>
            <button
              className="flex items-center gap-1 font-medium text-primary"
              onClick={() => setRulesOpen((value) => !value)}
              aria-expanded={rulesOpen}
            >
              Category Management Rules <ArrowRight size={14} />
            </button>
          </footer>
          {rulesOpen && (
            <section className={`${panel} mt-3`}>
              <Heading title="Category Management Rules" />
              <div className="mt-3 flex items-start gap-3 text-xs leading-relaxed text-muted-strong">
                <Info size={18} className="shrink-0 text-primary" />
                <p>
                  Productive applications support work, Neutral applications
                  depend on context, and Unproductive applications are outside
                  work scope. Use Change to update a sample classification. Your
                  changes recalculate the selected scope’s totals and charts.
                  This preview does not apply monitoring policies to real
                  employees.
                </p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
