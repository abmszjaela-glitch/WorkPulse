import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useApiData from '../hooks/useApiData.js'
import { queryString } from '../services/api.js'
import {
  ApiPage,
  Panel,
  Metrics,
  ApiTable,
  Pagination,
  DateFilters,
  DailyBars,
} from '../components/data/ApiView.jsx'
import {
  duration,
  rangeDays,
  employeeName,
  fieldClass,
} from '../utils/analytics.js'

export default function ActivityDetailsPage() {
  const [params, setParams] = useSearchParams()
  const id = params.get('employeeId') || ''
  const [range, setRange] = useState(() => rangeDays(7))
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const filter = queryString(range)
  const resource = useApiData({
    employees:
      '/employees?' + queryString({ pageSize: 100, search: employeeSearch }),
    employee: id && `/employees/${id}`,
    summary: id && `/activity/employee/${id}/summary?${filter}`,
    timeline: id && `/activity/employee/${id}/timeline?${filter}`,
    trend: id && `/activity/employee/${id}/trend?${filter}`,
    logs:
      id &&
      `/activity/employee/${id}/log?${queryString({ ...range, page, pageSize: 20, status })}`,
    apps: id && `/app-usage/employee/${id}?${filter}&pageSize=100`,
  })
  const { data } = resource
  const employee = data.employee,
    summary = data.summary?.data
  return (
    <ApiPage
      title="Activity Details"
      subtitle="Employee intervals and application durations from the database"
      resource={resource}
    >
      <Panel title="Employee and date range">
        <div className="flex flex-wrap gap-4">
          <input
            className={fieldClass}
            type="search"
            aria-label="Find activity employee"
            placeholder="Find employee by name or ID"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
          />
          <label className="text-sm">
            Employee{' '}
            <select
              className={fieldClass}
              aria-label="Activity employee"
              value={id}
              onChange={(e) => {
                setParams(e.target.value ? { employeeId: e.target.value } : {})
                setPage(1)
              }}
            >
              <option value="">Select employee</option>
              {(data.employees?.items || []).map((row) => (
                <option key={row.id} value={row.id}>
                  {employeeName(row)} · {row.employee_code}
                </option>
              ))}
            </select>
          </label>
          <DateFilters
            value={range}
            onChange={(value) => {
              setRange(value)
              setPage(1)
            }}
          />
        </div>
        {employee && (
          <p className="mt-4 text-sm text-muted">
            {employeeName(employee)} · {employee.employee_code} ·{' '}
            {employee.department_name || 'Unassigned'} · {employee.email}
          </p>
        )}
      </Panel>
      {!id ? (
        <Panel title="Select an employee">
          Choose an employee to view their authorized activity records.
        </Panel>
      ) : (
        <>
          <Metrics
            items={[
              [
                'Total monitored time',
                duration(summary?.total_monitored_seconds),
              ],
              ['Active time', duration(summary?.active_seconds)],
              ['Idle time', duration(summary?.idle_seconds)],
              ['Recorded intervals', summary?.record_count],
            ]}
          />
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel
              title="Hourly activity timeline"
              subtitle="Hours are allocated by recorded interval overlap"
            >
              <ApiTable
                rows={data.timeline?.data || []}
                rowKey={(row) => row.timestamp}
                columns={[
                  ['Hour', 'label'],
                  ['Active', (row) => duration(row.active_seconds)],
                  ['Idle', (row) => duration(row.idle_seconds)],
                ]}
              />
            </Panel>
            <Panel title="Activity trend">
              <DailyBars data={data.trend?.data || []} />
            </Panel>
          </div>
          <Panel title="Application usage">
            <ApiTable
              rows={data.apps?.data || []}
              rowKey={(row) => row.application_name}
              columns={[
                ['Application', 'application_name'],
                ['Category', (row) => row.category || 'Unclassified'],
                ['Time', (row) => duration(row.seconds)],
              ]}
            />
          </Panel>
          <Panel
            title="Activity log"
            subtitle="Aggregate interval counts only; typed text and window contents are never collected"
          >
            <label className="text-sm">
              Status{' '}
              <select
                className={fieldClass}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All</option>
                <option>ACTIVE</option>
                <option>IDLE</option>
              </select>
            </label>
            <ApiTable
              rows={data.logs?.data || []}
              rowKey={(row) => `${row.device_id}:${row.record_id}`}
              columns={[
                [
                  'Start',
                  (row) => new Date(row.interval_start).toLocaleString(),
                ],
                ['End', (row) => new Date(row.interval_end).toLocaleString()],
                ['Status', 'status'],
                ['Mouse movements', 'mouse_movements'],
                ['Clicks', 'mouse_clicks'],
                ['Anonymous key presses', 'key_presses'],
                ['Active', (row) => duration(row.active_seconds)],
                ['Idle', (row) => duration(row.idle_seconds)],
              ]}
            />
            <Pagination
              page={page}
              pageSize={20}
              total={data.logs?.pagination?.total}
              onPage={setPage}
            />
          </Panel>
          <p className="text-xs text-muted">
            Productivity score is unavailable until an official formula is
            approved. Paused time is separate from idle time and is not
            fabricated from missing intervals.
          </p>
        </>
      )}
    </ApiPage>
  )
}
