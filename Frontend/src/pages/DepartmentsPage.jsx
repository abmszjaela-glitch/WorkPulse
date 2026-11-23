import { useState } from 'react'
import useAuth from '../hooks/useAuth.js'
import useApiData from '../hooks/useApiData.js'
import Modal from '../components/ui/Modal.jsx'
import { apiRequest, queryString, downloadApiFile } from '../services/api.js'
import {
  ApiPage,
  Panel,
  Metrics,
  ApiTable,
  Pagination,
} from '../components/data/ApiView.jsx'
import {
  fieldClass,
  actionClass,
  duration,
  employeeName,
} from '../utils/analytics.js'

function DepartmentForm({ record, managers, onClose, onSave }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await onSave({
        name: form.get('name').trim(),
        description: form.get('description').trim(),
        managerId: form.get('managerId') || null,
        active: form.get('active') === 'on',
      })
      onClose()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      onClose={() => !busy && onClose()}
      titleId="department-form-title"
      className="m-auto w-[min(480px,calc(100%_-_32px))] rounded-2xl bg-white p-6 shadow-floating"
    >
      <h2 id="department-form-title" className="text-lg font-semibold">
        {record ? 'Edit department' : 'Add department'}
      </h2>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm">
            Name
            <input
              className={`${fieldClass} mt-1 w-full`}
              name="name"
              required
              maxLength={100}
              defaultValue={record?.name}
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
              className={`${fieldClass} mt-1 w-full`}
              name="description"
              maxLength={2000}
              defaultValue={record?.description}
            />
          </label>
          <label className="block text-sm">
            Manager
            <select
              className={`${fieldClass} mt-1 w-full`}
              name="managerId"
              defaultValue={record?.manager_id || ''}
            >
              <option value="">Unassigned</option>
              {managers.map((row) => (
                <option key={row.id} value={row.id}>
                  {employeeName(row)}
                </option>
              ))}
              {record?.manager_id &&
                !managers.some((row) => row.id === record.manager_id) && (
                  <option value={record.manager_id}>{record.manager_id}</option>
                )}
            </select>
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={record?.is_active ?? true}
            />
            Active
          </label>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className={fieldClass} onClick={onClose}>
              Cancel
            </button>
            <button className={actionClass}>
              {busy ? 'Saving…' : 'Save department'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}

function DeleteDialog({ record, departments, onClose, onDelete }) {
  const [target, setTarget] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await onDelete(target)
      onClose()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      onClose={() => !busy && onClose()}
      titleId="department-delete-title"
      className="m-auto w-[min(440px,calc(100%_-_32px))] rounded-2xl bg-white p-6 shadow-floating"
    >
      <h2 id="department-delete-title" className="text-lg font-semibold">
        Delete department?
      </h2>
      <p className="my-4 text-sm">
        {record.name} · {record.employee_count} employees. The backend retains
        historical data.
      </p>
      {record.employee_count > 0 && (
        <label className="block text-sm">
          Reassign employees first
          <select
            className={`${fieldClass} mt-2 w-full`}
            aria-label="Replacement department"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose department</option>
            {departments
              .filter((row) => row.id !== record.id && row.is_active)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-error">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <button className={fieldClass} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="rounded-lg bg-error px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy || (record.employee_count > 0 && !target)}
          onClick={submit}
        >
          {busy ? 'Deleting…' : 'Delete department'}
        </button>
      </div>
    </Modal>
  )
}

export default function DepartmentsPage() {
  const { session } = useAuth()
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [modal, setModal] = useState(null),
    [message, setMessage] = useState('')
  const filters = { search, status }
  const resource = useApiData({
    departments: `/departments?${queryString({ ...filters, page, pageSize: 12 })}`,
    options: '/departments?pageSize=100',
    managers: '/employees?pageSize=100',
    employees: '/employees/summary',
    stats: '/dashboard/stats',
    metrics: '/dashboard/department-productivity?pageSize=100',
  })
  const { data } = resource
  const managers = (data.managers?.items || []).filter(
    (row) => ['A', 'M'].includes(row.role) && row.is_active,
  )
  const managerNames = new Map(
    (data.managers?.items || []).map((row) => [row.id, employeeName(row)]),
  )
  const activity = new Map(
    (data.metrics?.data || []).map((row) => [row.id, row]),
  )
  const save = async (body) => {
    await apiRequest(
      session.accessToken,
      modal?.record ? `/departments/${modal.record.id}` : '/departments',
      { method: modal?.record ? 'PUT' : 'POST', body },
    )
    resource.reload()
    setMessage('Department saved in the database.')
  }
  const remove = async (target) => {
    await apiRequest(session.accessToken, `/departments/${modal.record.id}`, {
      method: 'DELETE',
      body: target ? { reassignToDepartmentId: target } : {},
    })
    resource.reload()
    setMessage('Department removed; employees reassigned where required.')
  }
  return (
    <ApiPage
      title="Departments"
      subtitle="Manage real department assignments and activity totals"
      resource={resource}
      actions={
        <>
          <button
            className={fieldClass}
            onClick={async () => {
              try {
                await downloadApiFile(
                  session.accessToken,
                  `/departments/export?${queryString(filters)}`,
                  'WorkPulse-departments.csv',
                )
              } catch (failure) {
                setMessage(failure.message)
              }
            }}
          >
            Export CSV
          </button>
          <button
            className={actionClass}
            onClick={() => setModal({ type: 'edit' })}
          >
            Add Department
          </button>
        </>
      }
    >
      <Metrics
        items={[
          ['Departments', data.departments?.total],
          ['Employees', data.employees?.totalEmployees],
          ['Active now', data.stats?.data?.active],
          ['Productivity score', 'Unavailable', 'Formula not approved'],
        ]}
      />
      <Panel title="All departments">
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            className={fieldClass}
            type="search"
            aria-label="Search departments"
            placeholder="Search departments"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
          <select
            className={fieldClass}
            aria-label="Department status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {message && (
          <p role="status" className="my-3 text-sm">
            {message}
          </p>
        )}
        <ApiTable
          rows={data.departments?.items || []}
          columns={[
            [
              'Department',
              (row) => (
                <div>
                  <strong>{row.name}</strong>
                  <p className="text-xs text-muted">{row.description}</p>
                </div>
              ),
            ],
            [
              'Manager',
              (row) =>
                managerNames.get(row.manager_id) ||
                (row.manager_id ? row.manager_id : 'Unassigned'),
            ],
            ['Employees', 'employee_count'],
            ['Active accounts', 'active_accounts'],
            [
              'Active time today',
              (row) => duration(activity.get(row.id)?.active_seconds),
            ],
            ['Status', (row) => (row.is_active ? 'Active' : 'Inactive')],
            [
              'Actions',
              (row) => (
                <div className="flex gap-2">
                  <button
                    className="text-primary"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => setModal({ type: 'edit', record: row })}
                  >
                    Edit
                  </button>
                  <button
                    className="text-error"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => setModal({ type: 'delete', record: row })}
                  >
                    Delete
                  </button>
                </div>
              ),
            ],
          ]}
        />
        <Pagination
          page={page}
          pageSize={12}
          total={data.departments?.total}
          onPage={setPage}
        />
      </Panel>
      {modal?.type === 'edit' && (
        <DepartmentForm
          record={modal.record}
          managers={managers}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteDialog
          record={modal.record}
          departments={data.options?.items || []}
          onClose={() => setModal(null)}
          onDelete={remove}
        />
      )}
    </ApiPage>
  )
}
