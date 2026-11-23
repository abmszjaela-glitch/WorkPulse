import { downloadCsv } from '../utils/download.js'
import Button from '../components/ui/Button.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
  UserRoundX,
  KeyRound,
  Activity,
} from 'lucide-react'
import Sidebar from '../components/layout/Sidebar.jsx'
import EmployeeDialog from '../components/employees/EmployeeDialog.jsx'
import DeviceActivationDialog from '../components/employees/DeviceActivationDialog.jsx'
import { employeeRoles } from '../data/employees.js'
import useAuth from '../hooks/useAuth.js'
import useEmployeeDirectory from '../hooks/useEmployeeDirectory.js'
import {
  createEmployee,
  updateEmployee,
  deactivateEmployees,
  assignDepartment,
  exportEmployees,
  setEmployeeStatus,
} from '../services/employees.js'
import { employeePayload } from '../utils/employees.js'

export default function EmployeesPage() {
  const { session } = useAuth()
  const token = session.accessToken
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(8)
  const [modal, setModal] = useState(null)
  const [deviceEmployee, setDeviceEmployee] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const selectAll = useRef(null)
  const {
    rows,
    total,
    summary,
    departments,
    loading,
    error,
    metadataError,
    reload,
  } = useEmployeeDirectory(
    token,
    { search, departmentId: department, role, status, page, pageSize },
    setPage,
  )
  const filtered = rows
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = rows
  const allChecked =
    visible.length > 0 && visible.every((row) => selected.includes(row.id))
  const someChecked = visible.some((row) => selected.includes(row.id))
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = someChecked && !allChecked
  }, [someChecked, allChecked])
  const toggleRow = (id) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    )
  const changeFilter = (setter) => (event) => {
    setter(event.target.value)
    setPage(1)
    setSelected([])
  }
  const resetFilters = () => {
    setSearch('')
    setDepartment('')
    setRole('')
    setStatus('')
    setPage(1)
    setSelected([])
  }
  const saveEmployee = async (data, originalId) => {
    if (
      !data.firstName?.trim() ||
      !data.lastName?.trim() ||
      !data.employeeCode?.trim() ||
      !data.email?.trim()
    )
      return {
        message: 'First name, last name, email and employee ID are required.',
      }
    try {
      const original = originalId
        ? modal?.employee || rows.find((row) => row.id === originalId)
        : null
      const payload = employeePayload(data, original)
      if (originalId && !Object.keys(payload).length) return null
      const saved = originalId
        ? await updateEmployee(token, originalId, payload)
        : await createEmployee(token, payload)
      setSelected([])
      setPage(1)
      if (!originalId) {
        setSearch(saved.employee_code)
        setDepartment('')
        setRole('')
        setStatus('')
      }
      reload()
      setNotice(
        originalId
          ? 'Employee changes saved to the database.'
          : 'Employee created in the database. Showing the saved employee.',
      )
      return null
    } catch (failure) {
      return { message: failure.message }
    }
  }
  const bulkUpdate = async (newDepartment) => {
    const ids = modal.targets?.map((row) => row.id) || selected
    if (!ids.length) return { message: 'Select an employee first.' }
    try {
      if (modal.type === 'department') {
        const failed = []
        for (const id of ids) {
          try {
            await assignDepartment(token, id, newDepartment)
          } catch {
            failed.push(id)
          }
        }
        reload()
        setPage(1)
        setSelected(failed)
        if (failed.length)
          return {
            message:
              ids.length -
              failed.length +
              ' updated; ' +
              failed.length +
              ' could not be reassigned. Reload and retry the remaining employees.',
          }
      } else {
        await deactivateEmployees(token, ids)
        reload()
        setPage(1)
        setSelected([])
      }
      setNotice(ids.length + ' employee account(s) updated in the database.')
      return null
    } catch (failure) {
      return { message: failure.message }
    }
  }
  const exportCsv = async () => {
    try {
      downloadCsv(
        await exportEmployees(token, {
          search,
          departmentId: department,
          role,
          status,
        }),
        'workpulse-employees.csv',
      )
      setNotice('Employee CSV downloaded from the database.')
    } catch (failure) {
      setNotice(failure.message)
    }
  }
  const activate = async (employee) => {
    try {
      await setEmployeeStatus(token, employee.id, true)
      reload()
      setNotice('Employee account activated.')
    } catch (failure) {
      setNotice(failure.message)
    }
  }
  return (
    <div className="dashboard-shell employee-management">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNotice={setNotice}
      />
      <div className="dashboard-workspace">
        <PageHeader
          title="Employees"
          subtitle="Manage employees and account access"
          search={{
            label: 'Search all employees',
            value: search,
            onChange: (value) => {
              setSearch(value)
              setPage(1)
              setSelected([])
            },
          }}
          onMenuOpen={() => setMenuOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="dashboard-content management-content"
        >
          <nav className="em-breadcrumb" aria-label="Breadcrumb">
            <Link to="/dashboard">Dashboard</Link>
            <ChevronRight size={12} />
            <span aria-current="page">Employees</span>
          </nav>
          <div className="management-title">
            <div>
              <h1>Employee Management</h1>
              <p>
                Add, edit and manage employees and their access across the
                organization.
              </p>
            </div>
            <div className="management-actions">
              <Button type="button" variant="secondary" onClick={exportCsv}>
                <Download size={16} />
                Export CSV
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={loading || !!error || !!metadataError || !summary}
                onClick={() => setModal({ type: 'add' })}
              >
                <Plus size={17} />
                Add Employee
              </Button>
            </div>
          </div>
          <p className="em-preview-label">
            Employee records are loaded from the database. Changes require
            server confirmation.
          </p>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          {(error || metadataError) && (
            <div
              role="alert"
              className="rounded-xl border border-error/20 bg-red-50 p-4 text-sm text-error"
            >
              {error || metadataError}
              <button type="button" className="ml-3 underline" onClick={reload}>
                Retry loading employees
              </button>
            </div>
          )}
          {loading && (
            <p role="status" className="my-4 text-sm text-muted">
              Loading employees…
            </p>
          )}
          <section
            className="management-stats"
            aria-label="Employee account summary"
          >
            {[
              {
                label: 'Total Employees',
                count: summary?.totalEmployees ?? '—',
                detail: 'Registered accounts',
                Icon: UsersRound,
                tone: 'blue',
              },
              {
                label: 'Active Accounts',
                count: summary?.activeAccounts ?? '—',
                detail: summary?.totalEmployees
                  ? Math.round(
                      (summary.activeAccounts / summary.totalEmployees) * 100,
                    ) + '% active rate'
                  : 'No registered accounts',
                Icon: ShieldCheck,
                tone: 'green',
              },
              {
                label: 'Deactivated',
                count: summary?.deactivated ?? '—',
                detail: 'Accounts disabled',
                Icon: UserRoundX,
                tone: 'red',
              },
              {
                label: 'Agent Not Installed',
                count: summary?.agentNotInstalled ?? '—',
                detail: 'Pending consent / setup',
                Icon: TriangleAlert,
                tone: 'muted',
              },
            ].map(({ label, count, detail, Icon, tone }) => (
              <article className={`management-stat ${tone}`} key={label}>
                <div>
                  <h2>{label}</h2>
                  <strong>{count}</strong>
                  <p>
                    <i />
                    {detail}
                  </p>
                </div>
                <span className="management-stat-icon">
                  <Icon size={23} />
                </span>
              </article>
            ))}
          </section>
          <section className="management-filters" aria-label="Employee filters">
            <label className="management-search">
              <Search size={17} />
              <input
                aria-label="Search employees by name, role, email or employee ID"
                placeholder="Search by name, role, email or employee ID…"
                value={search}
                onChange={changeFilter(setSearch)}
              />
            </label>
            {[
              ['Department', department, setDepartment, departments],
              ['Role', role, setRole, employeeRoles],
              ['Status', status, setStatus, ['Active', 'Deactivated']],
            ].map(([label, value, setter, choices]) => (
              <label className="management-select" key={label}>
                <span className="sr-only">{label}</span>
                <select value={value} onChange={changeFilter(setter)}>
                  <option value="">{label}: All</option>
                  {choices.map((choice) => (
                    <option
                      key={typeof choice === 'string' ? choice : choice.id}
                      value={typeof choice === 'string' ? choice : choice.id}
                    >
                      {typeof choice === 'string' ? choice : choice.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button className="reset-filters" onClick={resetFilters}>
              Reset filters
            </button>
          </section>
          {selected.length > 0 && (
            <section
              className="bulk-toolbar"
              aria-label="Selected employee actions"
            >
              <div>
                <input
                  type="checkbox"
                  checked
                  aria-label="Clear selection"
                  onChange={() => setSelected([])}
                />
                <strong>
                  {selected.length} employee{selected.length === 1 ? '' : 's'}{' '}
                  selected
                </strong>
              </div>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setModal({ type: 'department' })}
                >
                  Change Department
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() =>
                    setModal({
                      type: 'deactivate',
                      targets: rows.filter((row) => selected.includes(row.id)),
                    })
                  }
                >
                  <Ban size={15} />
                  Deactivate
                </Button>
              </div>
            </section>
          )}
          <section
            className="management-table-panel"
            aria-label="Employee directory"
          >
            <div className="management-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        ref={selectAll}
                        type="checkbox"
                        aria-label="Select all employees on this page"
                        checked={allChecked}
                        onChange={() =>
                          setSelected((previous) =>
                            allChecked
                              ? previous.filter(
                                  (id) => !visible.some((row) => row.id === id),
                                )
                              : [
                                  ...new Set([
                                    ...previous,
                                    ...visible.map((row) => row.id),
                                  ]),
                                ],
                          )
                        }
                      />
                    </th>
                    <th>Employee</th>
                    <th>Employee ID</th>
                    <th>Department</th>
                    <th>Role</th>
                    <th>Device / Agent</th>
                    <th>Last Active</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((employee) => (
                    <tr
                      key={employee.id}
                      className={
                        selected.includes(employee.id) ? 'row-selected' : ''
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(employee.id)}
                          onChange={() => toggleRow(employee.id)}
                          aria-label={`Select ${employee.name}`}
                        />
                      </td>
                      <td>
                        <div className="management-identity">
                          <span>
                            {employee.name
                              .split(' ')
                              .map((part) => part[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <div>
                            <strong>{employee.name}</strong>
                            <small>{employee.email}</small>
                          </div>
                        </div>
                      </td>
                      <td className="employee-id">{employee.employeeCode}</td>
                      <td>{employee.department}</td>
                      <td>
                        <span
                          className={`role-badge ${employee.role.toLowerCase()}`}
                        >
                          {employee.role}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`agent-status ${employee.agent === 'Connected' ? 'connected' : employee.agent === 'Offline' ? 'offline' : 'not-installed'}`}
                        >
                          <i />
                          {employee.agent}
                        </span>
                      </td>
                      <td className="last-active">{employee.lastActive}</td>
                      <td>
                        <span
                          className={`management-status ${employee.status === 'Active' ? 'active' : 'deactivated'}`}
                        >
                          <i />
                          {employee.status}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link
                            aria-label={`Activity for ${employee.name}`}
                            to={'/activity-details?employeeId=' + employee.id}
                          >
                            <Activity size={16} />
                          </Link>
                          {employee.status === 'Active' && (
                            <button
                              aria-label={`Connect Agent for ${employee.name}`}
                              onClick={() => setDeviceEmployee(employee)}
                            >
                              <KeyRound size={16} />
                            </button>
                          )}
                          <button
                            aria-label={`View ${employee.name}`}
                            onClick={() => setModal({ type: 'view', employee })}
                          >
                            <Eye size={17} />
                          </button>
                          <button
                            aria-label={`Edit ${employee.name}`}
                            onClick={() => setModal({ type: 'edit', employee })}
                          >
                            <Pencil size={16} />
                          </button>
                          {employee.status === 'Deactivated' && (
                            <button
                              aria-label={'Activate ' + employee.name}
                              onClick={() => activate(employee)}
                            >
                              <ShieldCheck size={16} />
                            </button>
                          )}
                          {employee.status === 'Active' && (
                            <button
                              aria-label={`Deactivate ${employee.name}`}
                              onClick={() =>
                                setModal({
                                  type: 'deactivate',
                                  targets: [employee],
                                })
                              }
                            >
                              <UserRoundX size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !error && filtered.length === 0 && (
                <div className="empty-state">
                  <UsersRound size={28} />
                  <h2>No employees found</h2>
                  <p>Try another search or reset your filters.</p>
                  <button className="reset-filters" onClick={resetFilters}>
                    Reset filters
                  </button>
                </div>
              )}
            </div>
            <div className="management-pagination">
              <p>
                Showing{' '}
                <strong>{total ? (currentPage - 1) * pageSize + 1 : 0}</strong>{' '}
                to <strong>{Math.min(currentPage * pageSize, total)}</strong> of{' '}
                <strong>{total}</strong> employees
              </p>
              <div>
                <label>
                  Rows per page:{' '}
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={(event) => {
                      setSelected([])
                      setPageSize(Number(event.target.value))
                      setPage(1)
                    }}
                  >
                    {[5, 8, 16, 32].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <nav aria-label="Employee pages">
                  <button
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    onClick={() => {
                      setPage(currentPage - 1)
                      setSelected([])
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: pages }, (_, index) => (
                    <button
                      className={currentPage === index + 1 ? 'current' : ''}
                      aria-current={
                        currentPage === index + 1 ? 'page' : undefined
                      }
                      key={index}
                      onClick={() => {
                        setPage(index + 1)
                        setSelected([])
                      }}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === pages}
                    aria-label="Next page"
                    onClick={() => {
                      setPage(currentPage + 1)
                      setSelected([])
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </nav>
              </div>
            </div>
          </section>
        </main>
      </div>
      {modal && (
        <EmployeeDialog
          departments={departments}
          modal={modal}
          onClose={() => setModal(null)}
          onSave={saveEmployee}
          onBulk={bulkUpdate}
        />
      )}
      {deviceEmployee && (
        <DeviceActivationDialog
          employee={deviceEmployee}
          onClose={() => setDeviceEmployee(null)}
        />
      )}
    </div>
  )
}
