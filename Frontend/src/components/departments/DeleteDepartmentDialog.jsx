import Modal from '../ui/Modal.jsx'
import { useState } from 'react'
import { Building2, CircleAlert, Trash2, TriangleAlert, X } from 'lucide-react'

export default function DeleteDepartmentDialog({
  department,
  departments,
  onClose,
  onDelete,
}) {
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const destinations = departments.filter(
    (row) => row.id !== department.id && row.status === 'Active',
  )
  const submit = (event) => {
    event.preventDefault()
    const message = onDelete(department.id, target)
    if (message) setError(message)
    else onClose()
  }
  return (
    <Modal
      onClose={onClose}
      titleId="delete-department-title"
      descriptionId="delete-department-description"
      className="relative m-auto max-h-[calc(100svh_-_32px)] w-[min(440px,calc(100%_-_32px))] overflow-y-auto rounded-2xl border border-white/70 bg-white p-6 text-primary-dark shadow-floating backdrop:bg-sidebar/40 backdrop:backdrop-blur-sm"
    >
      <button
        className="absolute right-4 top-4 rounded-lg p-1 text-muted hover:bg-soft"
        aria-label="Close delete department dialog"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-100 text-error">
        <TriangleAlert size={25} />
      </span>
      <h2
        id="delete-department-title"
        className="mt-4 text-center text-2xl font-semibold tracking-tight"
      >
        Delete department?
      </h2>
      <div className="mx-auto mt-3 flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-full bg-soft px-3 py-2 text-xs">
        <Building2 size={15} className="shrink-0 text-primary" />
        <strong className="font-medium">{department.name}</strong>
        <span className="size-1 rounded-full bg-slate-300" />
        <span className="text-[11px] text-muted">
          {department.employees} Employees
        </span>
      </div>
      <p
        id="delete-department-description"
        className="mt-4 text-center text-[13px] leading-relaxed text-muted-strong"
      >
        {department.employees
          ? 'Employees in this department must be reassigned. Choose an active department to receive them before deleting this group.'
          : 'This department has no assigned employees. Delete it from this preview?'}
      </p>
      <form onSubmit={submit}>
        {department.employees > 0 && (
          <label className="mt-4 block text-xs font-medium">
            Reassign employees to
            <select
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value)
                setError('')
              }}
              aria-describedby={error ? 'delete-department-error' : undefined}
              aria-invalid={Boolean(error)}
            >
              <option value="">Select a department</option>
              {destinations.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            {!destinations.length && (
              <span className="mt-2 block text-[11px] text-error">
                Create or activate another department before deleting this one.
              </span>
            )}
          </label>
        )}
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[11px] leading-relaxed text-error">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <p>
            This removes the department from the current preview session.{' '}
            {department.employees > 0
              ? 'Employee totals will transfer to the selected department. '
              : ''}
            No historical records, live monitoring rules or real accounts are
            changed. Reloading restores the sample data.
          </p>
        </div>
        {error && (
          <p
            id="delete-department-error"
            className="mt-2 text-xs text-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            className="em-button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              department.employees > 0 && (!target || !destinations.length)
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={15} />
            Delete Department
          </button>
        </div>
      </form>
    </Modal>
  )
}
