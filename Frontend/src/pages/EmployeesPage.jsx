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
} from 'lucide-react'
import Sidebar from '../components/layout/Sidebar.jsx'
import EmployeeDialog from '../components/employees/EmployeeDialog.jsx'
import {
  employeeCsv,
  employeeDepartments,
  employeeRoles,
  filterEmployees,
  managementEmployees,
} from '../data/employees.js'

export default function EmployeesPage() {
  const [rows, setRows] = useState(managementEmployees)
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(8)
  const [modal, setModal] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const selectAll = useRef(null)
  const filtered = filterEmployees(rows, search, department, role, status)
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )
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
  const saveEmployee = (data, originalId) => {
    const next = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, value.trim()]),
    )
    if (!next.name || !next.id || !next.email)
      return { message: 'Name, email and employee ID are required.' }
    if (
      rows.some(
        (row) =>
          row.id !== originalId &&
          row.email.toLowerCase() === next.email.toLowerCase(),
      )
    )
      return { field: 'email', message: 'Email already exists.' }
    if (
      rows.some(
        (row) =>
          row.id !== originalId &&
          row.id.toLowerCase() === next.id.toLowerCase(),
      )
    )
      return { field: 'id', message: 'Employee ID already exists.' }
    setRows((previous) =>
      originalId
        ? previous.map((row) =>
            row.id === originalId ? { ...row, ...next } : row,
          )
        : [
            ...previous,
            { ...next, agent: 'Not installed', lastActive: 'Never' },
          ],
    )
    setSelected([])
    setNotice(
      originalId
        ? 'Employee updated in this preview.'
        : 'Employee added to this preview.',
    )
    return null
  }
  const bulkUpdate = (newDepartment) => {
    setRows((previous) =>
      previous.map((row) =>
        (
          modal.targets
            ? modal.targets.some((target) => target.id === row.id)
            : selected.includes(row.id)
        )
          ? {
              ...row,
              ...(modal.type === 'department'
                ? { department: newDepartment }
                : {
                    status: 'Deactivated',
                    agent: row.agent === 'Connected' ? 'Offline' : row.agent,
                  }),
            }
          : row,
      ),
    )
    setNotice(
      `${modal.targets?.length || selected.length} employee account${(modal.targets?.length || selected.length) === 1 ? '' : 's'} updated in this preview.`,
    )
    setSelected([])
  }
  const exportCsv = () => {
    downloadCsv(employeeCsv(filtered), 'workpulse-employees.csv')
    setNotice(`Exported ${filtered.length} employee records.`)
  }
  const active = rows.filter((row) => row.status === 'Active').length
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
                onClick={() => setModal({ type: 'add' })}
              >
                <Plus size={17} />
                Add Employee
              </Button>
            </div>
          </div>
          <p className="em-preview-label">
            Preview data · Changes are temporary and reset when this page
            reloads.
          </p>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          <section
            className="management-stats"
            aria-label="Employee account summary"
          >
            {[
              {
                label: 'Total Employees',
                count: rows.length,
                detail: 'Employees in this preview',
                Icon: UsersRound,
                tone: 'blue',
              },
              {
                label: 'Active Accounts',
                count: active,
                detail: `${Math.round((active / Math.max(1, rows.length)) * 100)}% active rate`,
                Icon: ShieldCheck,
                tone: 'green',
              },
              {
                label: 'Deactivated',
                count: rows.length - active,
                detail: 'Accounts disabled',
                Icon: UserRoundX,
                tone: 'red',
              },
              {
                label: 'Agent Not Installed',
                count: rows.filter((row) => row.agent === 'Not installed')
                  .length,
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
              ['Department', department, setDepartment, employeeDepartments],
              ['Role', role, setRole, employeeRoles],
              ['Status', status, setStatus, ['Active', 'Deactivated']],
            ].map(([label, value, setter, choices]) => (
              <label className="management-select" key={label}>
                <span className="sr-only">{label}</span>
                <select value={value} onChange={changeFilter(setter)}>
                  <option value="">{label}: All</option>
                  {choices.map((choice) => (
                    <option key={choice}>{choice}</option>
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
                      <td className="employee-id">{employee.id}</td>
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
              {filtered.length === 0 && (
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
                <strong>
                  {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}
                </strong>{' '}
                to{' '}
                <strong>
                  {Math.min(currentPage * pageSize, filtered.length)}
                </strong>{' '}
                of <strong>{filtered.length}</strong> employees
              </p>
              <div>
                <label>
                  Rows per page:{' '}
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={(event) => {
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
                    onClick={() => setPage(currentPage - 1)}
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
                      onClick={() => setPage(index + 1)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === pages}
                    aria-label="Next page"
                    onClick={() => setPage(currentPage + 1)}
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
          employees={rows}
          modal={modal}
          onClose={() => setModal(null)}
          onSave={saveEmployee}
          onBulk={bulkUpdate}
        />
      )}
    </div>
  )
}
