import useMediaQuery from '../hooks/useMediaQuery.js'
import ReportCharts from '../components/reports/ReportCharts.jsx'
import { downloadCsv } from '../utils/download.js'
import Button from '../components/ui/Button.jsx'
import Heading from '../components/ui/SectionHeading.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Code2,
  Download,
  FileText,
  Filter,
  Hourglass,
  RefreshCw,
  Search,
  Sheet,
  TrendingUp,
  UsersRound,
} from 'lucide-react'

import Sidebar from '../components/layout/Sidebar.jsx'
import {
  buildReport,
  formatReportTime,
  reportChartData,
  reportCsv,
  reportDepartments,
  reportEmployees,
} from '../data/reports.js'

const initialFilters = {
  days: 7,
  department: '',
  employee: '',
  type: 'Summary',
}
const panel = 'rounded-2xl border border-line/70 bg-white shadow-card'
const control =
  'rounded-lg border border-line/70 bg-white px-3 py-2.5 text-xs text-ink outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10'
const categoryColors = ['#00652b', '#2563eb', '#c5161d']

export default function ReportsPage() {
  const printMode = useMediaQuery('print')
  const [tab, setTab] = useState('Weekly')
  const [draft, setDraft] = useState(initialFilters)
  const [applied, setApplied] = useState(initialFilters)
  const [search, setSearch] = useState('')
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [pageSize, setPageSize] = useState(8)
  const [page, setPage] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [exports, setExports] = useState([])
  const [allArchives, setAllArchives] = useState(false)
  const [generatedAt, setGeneratedAt] = useState(null)
  const report = buildReport(applied)
  const grouping = tab === 'Department' ? 'Department' : 'Employee'
  const rows = (grouping === 'Department' ? report.groups : report.rows).filter(
    (row) =>
      `${row.name} ${row.department || ''} ${row.role || ''} ${row.id || ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!onlyBelow || row.productivity < 75),
  )
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = printMode
    ? rows
    : rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const charts = reportChartData(report, applied.days)
  const employeeOptions = reportEmployees.filter(
    (person) => !draft.department || person.department === draft.department,
  )
  const categories = [
    {
      name: 'Productive',
      value: report.activeMinutes,
      color: categoryColors[0],
    },
    {
      name: 'Neutral / Communication',
      value: Math.round(report.idleMinutes * 0.62),
      color: categoryColors[1],
    },
    {
      name: 'Unproductive / Flagged',
      value: report.idleMinutes - Math.round(report.idleMinutes * 0.62),
      color: categoryColors[2],
    },
  ]
  const pending = JSON.stringify(draft) !== JSON.stringify(applied)
  const setFilter = (field, value) =>
    setDraft((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'department' ? { employee: '' } : {}),
    }))
  const chooseTab = (value) => {
    const next = {
      ...draft,
      days: value === 'Daily' ? 1 : value === 'Monthly' ? 30 : 7,
    }
    setTab(value)
    setDraft(next)
    setApplied(next)
    setPage(1)
    setGeneratedAt(null)
  }
  const generate = () => {
    if (tab !== 'Department' && tab !== 'Employee')
      setTab(
        draft.days === 1 ? 'Daily' : draft.days === 30 ? 'Monthly' : 'Weekly',
      )
    setApplied({ ...draft })
    setPage(1)
    setGeneratedAt(new Date())
    setNotice(
      'Report generated from the selected sample telemetry. No live data source is connected.',
    )
  }
  const reset = () => {
    setDraft(initialFilters)
    setApplied(initialFilters)
    setTab('Weekly')
    setSearch('')
    setOnlyBelow(false)
    setPage(1)
    setGeneratedAt(null)
  }
  const exportCsv = () => {
    const time = new Date()
    const content = reportCsv(rows, grouping)
    const filename = `workpulse-${grouping.toLowerCase()}-report-${time.getTime()}.csv`
    downloadCsv(content, filename)
    setExports((previous) => [
      {
        id: crypto.randomUUID(),
        name: `${tab} ${applied.type} Report · ${grouping}`,
        content,
        filename,
        time,
        records: rows.length,
      },
      ...previous,
    ])
    setNotice(
      `Exported ${rows.length} ${grouping.toLowerCase()} records. The export is available in this session’s recent exports.`,
    )
  }
  const stamp = (time) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Colombo',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(time)
  return (
    <div className="dashboard-shell reports-page">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNotice={setNotice}
      />
      <div className="dashboard-workspace">
        <PageHeader
          title="Reports & Analytics"
          subtitle="Generate and export productivity reports"
          search={{
            label: 'Search report records',
            value: search,
            onChange: (value) => {
              setSearch(value)
              setPage(1)
            },
          }}
          onMenuOpen={() => setMenuOpen(true)}
        />
        <main id="main-content" tabIndex={-1} className="dashboard-content">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-line/70">
            <nav
              className="flex max-w-full gap-1 overflow-x-auto"
              aria-label="Report views"
            >
              {['Daily', 'Weekly', 'Monthly', 'Department', 'Employee'].map(
                (value) => (
                  <button
                    key={value}
                    aria-pressed={tab === value}
                    onClick={() => chooseTab(value)}
                    className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs transition-colors ${tab === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-strong hover:text-primary'}`}
                  >
                    {value}
                    {tab === value && (
                      <span className="ml-1.5 inline-block size-1 rounded-full bg-primary align-middle" />
                    )}
                  </button>
                ),
              )}
            </nav>
            <span className="mb-2 flex items-center gap-1.5 text-[10px] text-muted">
              <i className="size-1.5 rounded-full bg-warning" />
              Preview telemetry · No live sync
            </span>
          </div>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          <section
            className={`${panel} p-5 sm:p-6`}
            aria-label="Report filters"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 rounded-lg border border-line/70 bg-soft pl-3 text-primary">
                <CalendarDays size={16} />
                <span className="sr-only">Report period</span>
                <select
                  className={`${control} !border-0 !bg-transparent`}
                  value={draft.days}
                  onChange={(event) =>
                    setFilter('days', Number(event.target.value))
                  }
                >
                  <option value={1}>Today · Sample day</option>
                  <option value={7}>Last 7 Days · Sample week</option>
                  <option value={30}>Last 30 Days · Sample month</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Report department</span>
                <select
                  className={control}
                  value={draft.department}
                  onChange={(event) =>
                    setFilter('department', event.target.value)
                  }
                >
                  <option value="">Department: All</option>
                  {reportDepartments.map((department) => (
                    <option key={department}>{department}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Report employee</span>
                <select
                  className={`${control} max-w-52`}
                  value={draft.employee}
                  onChange={(event) =>
                    setFilter('employee', event.target.value)
                  }
                >
                  <option value="">
                    Employee: All ({employeeOptions.length})
                  </option>
                  {employeeOptions.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Report type</span>
                <select
                  className={control}
                  value={draft.type}
                  onChange={(event) => setFilter('type', event.target.value)}
                >
                  <option value="Summary">Report Type: Summary</option>
                  <option value="Productivity">Productivity ranking</option>
                  <option value="Attendance">Attendance ranking</option>
                </select>
              </label>
              <Button type="button" variant="primary" onClick={generate}>
                <RefreshCw size={15} />
                Generate Report
              </Button>
              <button
                className="px-2 py-2 text-xs text-primary hover:text-blue-800"
                onClick={reset}
              >
                Reset
              </button>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.print()}
                  title="Open print dialog and choose Save as PDF"
                >
                  <FileText size={17} className="text-error" />
                  Export PDF
                </Button>
                <Button type="button" variant="secondary" onClick={exportCsv}>
                  <Sheet size={17} className="text-success-strong" />
                  Export CSV
                </Button>
              </div>
            </div>
            <p
              className={`mt-3 text-[10px] ${pending ? 'text-amber-700' : 'text-muted'}`}
              role="status"
            >
              {pending
                ? 'Filters changed. Select Generate Report to apply them.'
                : generatedAt
                  ? `Generated ${stamp(generatedAt)} · ${applied.type} · Sample telemetry only`
                  : 'Sample report · Category split and chart series are illustrative · Exports include the current table filters.'}
            </p>
          </section>
          <section
            className="my-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
            aria-label="Report summary"
          >
            {[
              {
                title: 'Avg Active Time',
                value: formatReportTime(report.avgActive),
                Icon: Clock3,
                detail: 'Per scheduled employee-day',
                tone: 'text-primary bg-soft',
              },
              {
                title: 'Avg Idle Time',
                value: formatReportTime(report.avgIdle),
                Icon: Hourglass,
                detail: 'Per scheduled employee-day',
                tone: 'text-indigo-700 bg-indigo-50',
              },
              {
                title: 'Productivity Score',
                value: `${report.productivity}%`,
                Icon: TrendingUp,
                detail: 'Active / total tracked time',
                tone: 'text-success-strong bg-green-50',
              },
              {
                title: 'Attendance Rate',
                value: `${report.attendance}%`,
                Icon: UsersRound,
                detail: `${report.workDays} scheduled workdays`,
                tone: 'text-primary bg-soft',
              },
              {
                title: 'Overtime Hours',
                value: formatReportTime(report.overtime),
                Icon: Clock3,
                detail: 'Tracked time above 8h / present day',
                tone: 'text-error bg-red-50',
              },
            ].map(({ title, value, Icon, detail, tone }) => (
              <article className={`${panel} p-4`} key={title}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-xs font-medium leading-relaxed text-muted-strong">
                    {title}
                  </h2>
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`}
                  >
                    <Icon size={17} />
                  </span>
                </div>
                <strong className="mt-4 block whitespace-nowrap text-[27px] font-bold tracking-tight text-ink">
                  {value}
                </strong>
                <p className="mt-3 text-[10px] leading-relaxed text-muted">
                  {detail}
                </p>
              </article>
            ))}
          </section>
          <ReportCharts
            report={report}
            applied={applied}
            charts={charts}
            categories={categories}
          />
          <section className={`${panel} mt-6 overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-4 p-6">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight text-ink">
                  {grouping === 'Department'
                    ? 'Detailed Department Telemetry'
                    : 'Detailed Employee Telemetry'}
                </h2>
                <span className="rounded-full bg-soft px-2 py-1 text-[10px] text-primary">
                  {rows.length} records
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-lg border border-line/70 bg-slate-50 px-3 py-2 text-muted-strong">
                  <Search size={16} />
                  <input
                    className="min-w-0 bg-transparent text-xs outline-none"
                    placeholder={
                      grouping === 'Department'
                        ? 'Search departments…'
                        : 'Search employee or role…'
                    }
                    aria-label="Search detailed report records"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                  />
                </label>
                <button
                  className={`em-button ${onlyBelow ? '!border-primary !bg-soft text-primary' : ''}`}
                  aria-pressed={onlyBelow}
                  onClick={() => {
                    setOnlyBelow((value) => !value)
                    setPage(1)
                  }}
                >
                  <Filter size={14} />
                  {onlyBelow ? 'Below 75%' : 'Filter'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-soft text-[10px] uppercase tracking-wide text-muted-strong">
                  <tr>
                    {(grouping === 'Department'
                      ? [
                          'Department',
                          'Employees',
                          'Total Hours',
                          'Active Time',
                          'Idle Time',
                          'Productivity %',
                        ]
                      : [
                          'Employee',
                          'Department',
                          'Total Hours',
                          'Active Time',
                          'Idle Time',
                          'Productivity %',
                          'Top Application',
                          'Days Present',
                        ]
                    ).map((label) => (
                      <th className="px-4 py-4 font-medium" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {visible.map((row) =>
                    grouping === 'Department' ? (
                      <tr key={row.name} className="hover:bg-slate-50">
                        <td className="px-4 py-5 font-medium">{row.name}</td>
                        <td className="px-4 py-5">{row.staff}</td>
                        <td className="px-4 py-5">
                          {formatReportTime(row.total)}
                        </td>
                        <td className="px-4 py-5 text-primary">
                          {formatReportTime(row.active)}
                        </td>
                        <td className="px-4 py-5 text-muted-strong">
                          {formatReportTime(row.idle)}
                        </td>
                        <td className="px-4 py-5 font-semibold text-success-strong">
                          {row.productivity}%
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
                              {row.name
                                .split(' ')
                                .map((name) => name[0])
                                .join('')}
                            </span>
                            <div>
                              <strong className="block max-w-28 font-medium leading-relaxed text-ink">
                                {row.name}
                              </strong>
                              <small className="text-[9px] text-muted-strong">
                                {row.id}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-strong">
                          {row.department}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-ink">
                          {formatReportTime(row.totalMinutes)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 font-medium text-primary">
                          {formatReportTime(row.activeMinutes)}
                        </td>
                        <td className="px-4 py-4 text-muted-strong">
                          {formatReportTime(row.idleMinutes)}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.productivity >= 80 ? 'bg-green-50 text-success-strong' : row.productivity < 60 ? 'bg-red-100 text-error' : 'bg-indigo-100 text-indigo-800'}`}
                          >
                            ● {row.productivity}%
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="flex items-center gap-1.5">
                            <Code2
                              size={15}
                              className="shrink-0 text-primary"
                            />
                            {row.app}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <span
                            className={
                              row.present === row.workDays
                                ? 'text-success-strong'
                                : 'text-muted-strong'
                            }
                          >
                            ●
                          </span>{' '}
                          {row.present} / {row.workDays}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {!visible.length && (
                <p className="px-6 py-14 text-center text-sm text-muted">
                  No records match these filters.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line/70 px-4 py-4 text-[11px] text-muted-strong">
              <p>
                Showing{' '}
                <strong>
                  {rows.length ? (currentPage - 1) * pageSize + 1 : 0}
                </strong>{' '}
                to{' '}
                <strong>{Math.min(currentPage * pageSize, rows.length)}</strong>{' '}
                of {rows.length} records
              </p>
              <label>
                Rows per page:{' '}
                <select
                  className={`${control} ml-1 !py-1`}
                  value={pageSize}
                  aria-label="Report records per page"
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                >
                  {[4, 8, 16].map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </label>
              <nav
                className="flex items-center gap-1"
                aria-label="Report pages"
              >
                <button
                  className="rounded border border-line/70 px-2 py-1.5 disabled:opacity-35"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                {Array.from({ length: pages }, (_, index) => (
                  <button
                    key={index}
                    className={`size-7 rounded ${currentPage === index + 1 ? 'bg-primary text-white' : 'hover:bg-soft'}`}
                    aria-current={
                      currentPage === index + 1 ? 'page' : undefined
                    }
                    onClick={() => setPage(index + 1)}
                  >
                    {index + 1}
                  </button>
                ))}
                <button
                  className="rounded border border-line/70 px-2 py-1.5 disabled:opacity-35"
                  disabled={currentPage === pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </nav>
            </div>
          </section>
          <section className={`${panel} mt-6 p-6`}>
            <Heading
              title="Recent Exports & Session Archives"
              subtitle="Downloadable CSV snapshots generated during this session"
            >
              <button
                className="text-xs text-primary"
                onClick={() => setAllArchives((value) => !value)}
                aria-expanded={allArchives}
              >
                {allArchives ? 'Show recent exports' : 'View all archives'} ›
              </button>
            </Heading>
            {exports.length ? (
              <div className="mt-5 divide-y divide-line/60">
                {(allArchives ? exports : exports.slice(0, 4)).map(
                  (archive) => (
                    <div
                      key={archive.id}
                      className="flex flex-wrap items-center gap-3 py-4"
                    >
                      <span className="rounded bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-success-strong">
                        CSV
                      </span>
                      <div className="min-w-0 flex-1">
                        <strong className="block text-xs font-medium text-ink">
                          {archive.name}
                        </strong>
                        <small className="text-[10px] text-muted-strong">
                          Generated {stamp(archive.time)} · {archive.records}{' '}
                          records · Preview export
                        </small>
                      </div>
                      <button
                        className="flex items-center gap-1 text-xs text-primary"
                        onClick={() =>
                          downloadCsv(archive.content, archive.filename)
                        }
                      >
                        <Download size={14} />
                        Download
                      </button>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 p-5">
                <CheckCircle2 size={22} className="shrink-0 text-muted" />
                <p className="text-xs leading-relaxed text-muted">
                  No exports yet. Export a CSV to create a downloadable snapshot
                  here. Scheduled archives require a connected backend.
                </p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
