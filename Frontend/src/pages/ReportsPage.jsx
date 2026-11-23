import { useState } from 'react'
import useAuth from '../hooks/useAuth.js'
import useApiData from '../hooks/useApiData.js'
import { queryString, downloadApiFile } from '../services/api.js'
import {
  ApiPage,
  Panel,
  Metrics,
  ApiTable,
  Pagination,
  DateFilters,
  DailyBars,
  CategoryChart,
} from '../components/data/ApiView.jsx'
import {
  duration,
  rangeDays,
  employeeName,
  fieldClass,
  actionClass,
} from '../utils/analytics.js'

export default function ReportsPage() {
  const { session } = useAuth()
  const [range, setRange] = useState(() => rangeDays(7))
  const [kind, setKind] = useState('weekly')
  const [reportType, setType] = useState('summary')
  const [departmentId, setDepartment] = useState('')
  const [employeeId, setEmployee] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState('')
  const filters = { ...range, reportType, departmentId, employeeId }
  const query = queryString(filters)
  const path =
    kind === 'department'
      ? departmentId && `/reports/department/${departmentId}`
      : kind === 'employee'
        ? employeeId && `/reports/employee/${employeeId}`
        : `/reports/${kind}`
  const resource = useApiData(
    {
      rows: path && `${path}?${query}&page=${page}&pageSize=20`,
      kpis: `/reports/kpis?${query}`,
      charts: `/reports/charts?${query}`,
      history: '/reports/recent-exports?pageSize=20',
      departments: '/departments?pageSize=100',
      employees: `/employees?${queryString({ departmentId, pageSize: 100, search: employeeSearch })}`,
    },
    { refreshMs: 30000 },
  )
  const { data } = resource
  const kpis = data.kpis?.data
  const exportReport = async (type) => {
    try {
      await downloadApiFile(
        session.accessToken,
        `/reports/export/${type}?${query}`,
        `WorkPulse-report.${type}`,
      )
      setMessage(
        `${type.toUpperCase()} downloaded; export history recorded by the backend.`,
      )
      resource.reload()
    } catch (error) {
      setMessage(error.message)
    }
  }
  const columns =
    reportType === 'summary'
      ? [
          ['Employee', (row) => row.employee_name || row.email],
          ['Employee ID', 'employee_code'],
          ['Department', 'department_name'],
          ['Total', (row) => duration(row.total_monitored_seconds)],
          ['Active', (row) => duration(row.active_seconds)],
          ['Idle', (row) => duration(row.idle_seconds)],
          ['Top app', 'top_application'],
          ['Observed days', 'observed_activity_days'],
        ]
      : reportType === 'application-usage'
        ? [
            ['Employee', 'employee_name'],
            ['Application', 'application_name'],
            ['Category', (row) => row.category || 'Unclassified'],
            ['Duration', (row) => duration(row.duration_seconds)],
          ]
        : [
            ['Employee', 'employee_name'],
            ['Start', (row) => new Date(row.interval_start).toLocaleString()],
            ['End', (row) => new Date(row.interval_end).toLocaleString()],
            ['Active', (row) => duration(row.active_seconds)],
            ['Idle', (row) => duration(row.idle_seconds)],
          ]
  return (
    <ApiPage
      title="Reports & Analytics"
      subtitle="Generate reports from stored employee intervals"
      resource={resource}
      actions={
        <>
          <button
            className={actionClass}
            disabled={!path}
            onClick={() => exportReport('csv')}
          >
            Export CSV
          </button>
          <button
            className={fieldClass}
            disabled={!path}
            onClick={() => exportReport('pdf')}
          >
            Export PDF
          </button>
        </>
      }
    >
      <Panel title="Report filters">
        <div className="flex flex-wrap gap-3">
          <input
            className={fieldClass}
            type="search"
            aria-label="Find report employee"
            placeholder="Find employee by name or ID"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
          />
          <select
            className={fieldClass}
            aria-label="Report period"
            value={kind}
            onChange={(e) => {
              const value = e.target.value
              setKind(value)
              setRange(
                rangeDays(value === 'daily' ? 1 : value === 'monthly' ? 30 : 7),
              )
              setPage(1)
            }}
          >
            {['daily', 'weekly', 'monthly', 'department', 'employee'].map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
          <DateFilters
            value={range}
            onChange={(value) => {
              setRange(value)
              setPage(1)
            }}
          />
          <select
            className={fieldClass}
            aria-label="Report department"
            value={departmentId}
            onChange={(e) => {
              setDepartment(e.target.value)
              setEmployee('')
              setPage(1)
            }}
          >
            <option value="">All departments</option>
            {(data.departments?.items || []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <select
            className={fieldClass}
            aria-label="Report employee"
            value={employeeId}
            onChange={(e) => {
              setEmployee(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All employees</option>
            {(data.employees?.items || []).map((row) => (
              <option key={row.id} value={row.id}>
                {employeeName(row)}
              </option>
            ))}
          </select>
          <select
            className={fieldClass}
            aria-label="Report type"
            value={reportType}
            onChange={(e) => {
              setType(e.target.value)
              setPage(1)
            }}
          >
            <option value="summary">Summary</option>
            <option value="activity">Activity</option>
            <option value="application-usage">Application usage</option>
          </select>
        </div>
        {!path && (
          <p className="mt-3 text-sm text-muted">
            Choose a department or employee for this report.
          </p>
        )}
        {message && (
          <p className="mt-3 text-sm" role="status">
            {message}
          </p>
        )}
      </Panel>
      <Metrics
        items={[
          ['Total monitored time', duration(kpis?.total_monitored_seconds)],
          ['Active time', duration(kpis?.active_seconds)],
          ['Idle time', duration(kpis?.idle_seconds)],
          ['Productivity score', 'Unavailable', 'No approved scoring formula'],
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Active vs idle">
          <DailyBars data={data.charts?.data?.active_vs_idle || []} />
        </Panel>
        <Panel title="Application categories">
          <CategoryChart
            items={data.charts?.data?.application_categories?.items || []}
          />
        </Panel>
      </div>
      <Panel title="Report records">
        <ApiTable
          rows={data.rows?.data || []}
          columns={columns}
          rowKey={(row) =>
            `${row.employee_id}:${row.device_id || ''}:${row.record_id || row.application_name || ''}`
          }
        />
        <Pagination
          page={page}
          pageSize={20}
          total={data.rows?.pagination?.total}
          onPage={setPage}
        />
      </Panel>
      <Panel
        title="Recent exports"
        subtitle="Server-recorded history; each file is delivered when generated"
      >
        <ApiTable
          rows={data.history?.data || []}
          columns={[
            ['Filename', 'filename'],
            ['Type', 'export_type'],
            ['Period', (row) => `${row.period_from} - ${row.period_to}`],
            ['Records', 'row_count'],
            ['Generated', (row) => new Date(row.generated_at).toLocaleString()],
          ]}
        />
      </Panel>
    </ApiPage>
  )
}
