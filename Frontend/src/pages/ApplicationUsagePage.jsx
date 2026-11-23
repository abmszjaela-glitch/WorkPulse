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
  CategoryChart,
  UsageTrend,
} from '../components/data/ApiView.jsx'
import {
  duration,
  rangeDays,
  fieldClass,
  actionClass,
} from '../utils/analytics.js'

export default function ApplicationUsagePage() {
  const { session } = useAuth()
  const [range, setRange] = useState(() => rangeDays(7))
  const [departmentId, setDepartment] = useState('')
  const [employeeId, setEmployee] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState('')
  const query = queryString({ ...range, departmentId })
  const resource = useApiData({
    apps: employeeId
      ? `/app-usage/employee/${employeeId}?${query}&page=${page}&pageSize=20`
      : `/app-usage?${query}&page=${page}&pageSize=20`,
    top: `/app-usage/top?${query}`,
    breakdown: `/app-usage/categories-breakdown?${query}`,
    trend: `/app-usage/trend?${query}`,
    departments: '/departments?pageSize=100',
    employees: `/employees?${queryString({ departmentId, pageSize: 100, search: employeeSearch })}`,
  })
  const { data } = resource
  const breakdown = data.breakdown?.data
  const exportCsv = async () => {
    try {
      await downloadApiFile(
        session.accessToken,
        `/app-usage/export?${query}`,
        'WorkPulse-application-usage.csv',
      )
      setMessage('CSV downloaded from the backend.')
    } catch (error) {
      setMessage(error.message)
    }
  }
  return (
    <ApiPage
      title="Application Usage"
      subtitle="Actual software usage reported by authorized devices"
      resource={resource}
      actions={
        <button className={actionClass} onClick={exportCsv}>
          Export CSV
        </button>
      }
    >
      <Panel title="Filters">
        <div className="flex flex-wrap gap-4">
          <input
            className={fieldClass}
            type="search"
            aria-label="Find application employee"
            placeholder="Find employee by name or ID"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
          />
          <DateFilters
            value={range}
            onChange={(value) => {
              setRange(value)
              setPage(1)
            }}
          />
          <select
            className={fieldClass}
            aria-label="Application department"
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
            aria-label="Application employee"
            value={employeeId}
            onChange={(e) => {
              setEmployee(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All employees</option>
            {(data.employees?.items || []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.first_name} {row.last_name} · {row.employee_code}
              </option>
            ))}
          </select>
        </div>
        {employeeId && (
          <p className="mt-3 text-xs text-muted">
            The table is scoped to this employee; organization charts keep the
            selected department scope.
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </Panel>
      <Metrics
        items={[
          ['Applications in scope', data.apps?.pagination?.total],
          ['Most used app', data.top?.data?.[0]?.application_name],
          [
            'Recorded application time',
            duration(breakdown?.total_application_seconds),
          ],
          [
            'Classification basis',
            'Application duration',
            'Category share is not a productivity score',
          ],
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Top 10 applications">
          <ApiTable
            rows={data.top?.data || []}
            rowKey={(row) => row.application_name}
            columns={[
              ['Application', 'application_name'],
              ['Time', (row) => duration(row.seconds)],
              ['Users', 'users'],
              ['Category', (row) => row.category || 'Unclassified'],
            ]}
          />
        </Panel>
        <Panel title="Category breakdown">
          <CategoryChart items={breakdown?.items || []} />
        </Panel>
      </div>
      <Panel title="Usage trend">
        <UsageTrend data={data.trend?.data || []} />
      </Panel>
      <Panel title="Tracked applications">
        <ApiTable
          rows={data.apps?.data || []}
          rowKey={(row) => row.application_name}
          columns={[
            ['Application', 'application_name'],
            ['Category', (row) => row.category || 'Unclassified'],
            ['Recorded time', (row) => duration(row.seconds)],
            ['Users', 'users'],
          ]}
        />
        <Pagination
          page={page}
          pageSize={20}
          total={data.apps?.pagination?.total}
          onPage={setPage}
        />
      </Panel>
    </ApiPage>
  )
}
