import Modal from '../ui/Modal.jsx'
import { useRef, useState } from 'react'
import { CircleAlert, Clock3, Info, TriangleAlert, X } from 'lucide-react'

export default function DepartmentDialog({
  department,
  managers,
  onClose,
  onSave,
}) {
  const nameInput = useRef(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState(department?.status !== 'Inactive')
  const submit = (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    if (!values.name.trim()) {
      setError('Department name is required.')
      nameInput.current.focus()
      return
    }
    const message = onSave(
      {
        ...Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, value.trim()]),
        ),
        status: active ? 'Active' : 'Inactive',
        managerTitle: department?.managerTitle || 'Department manager',
      },
      department?.id,
    )
    if (message) setError(message)
    else onClose()
  }
  const field =
    'mt-1.5 w-full rounded-xl border border-line/70 bg-white px-3.5 py-3 text-sm text-primary-dark shadow-sm outline-none placeholder:text-slate-300 focus:border-primary/50 focus:ring-4 focus:ring-primary/10'
  const nameError = error.includes('name')
  return (
    <Modal
      onClose={onClose}
      titleId="department-dialog-title"
      descriptionId="department-dialog-description"
      className="m-auto max-h-[calc(100svh_-_32px)] w-[min(480px,calc(100%_-_32px))] overflow-y-auto rounded-2xl border border-white/80 bg-white text-primary-dark shadow-floating backdrop:bg-sidebar/40 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-4 px-6 pb-6 pt-6">
        <div>
          <h2
            id="department-dialog-title"
            className="text-base font-semibold tracking-tight"
          >
            {department ? 'Edit Department' : 'Add Department'}
          </h2>
          <p
            id="department-dialog-description"
            className="mt-1 max-w-64 text-xs leading-relaxed text-muted-strong"
          >
            Define department details, assign leadership and set work shifts.
          </p>
        </div>
        <button
          className="rounded-lg p-1 text-muted transition-colors hover:bg-soft"
          onClick={onClose}
          aria-label="Close department dialog"
        >
          <X size={19} />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-4 px-5 sm:px-6">
          <label className="block text-sm font-medium">
            Department Name <span className="text-error">*</span>
            <div className="relative">
              <input
                ref={nameInput}
                className={`${field} pr-10 ${nameError ? '!border-error focus:ring-error/10' : ''}`}
                name="name"
                defaultValue={department?.name}
                placeholder="e.g. Platform Infrastructure"
                required
                maxLength={80}
                autoFocus
                onChange={() => setError('')}
                aria-invalid={nameError}
                aria-describedby={nameError ? 'department-error' : undefined}
              />
              {nameError && (
                <CircleAlert
                  size={17}
                  className="absolute right-3.5 top-5 text-error"
                />
              )}
            </div>
            {nameError && (
              <span
                id="department-error"
                className="mt-1.5 flex items-center gap-1 text-[11px] font-normal text-error"
                role="alert"
              >
                <TriangleAlert size={13} />
                {error}
              </span>
            )}
          </label>
          <label className="block text-sm font-medium">
            Description
            <textarea
              className={`${field} min-h-24 resize-y font-normal`}
              name="description"
              defaultValue={department?.description}
              placeholder="Briefly describe department focus and team responsibilities…"
              maxLength={300}
            />
          </label>
          <label className="block text-sm font-medium">
            Department Manager
            <select
              className={`${field} font-normal`}
              name="managerId"
              defaultValue={department?.managerId || ''}
            >
              <option value="">Select a manager</option>
              {managers
                .filter((manager) => manager.status === 'Active')
                .map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name} ({manager.id}) · {manager.department}
                  </option>
                ))}
            </select>
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              Working Hours Schedule
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-strong">
                Start Time
                <div className="relative">
                  <Clock3
                    className="pointer-events-none absolute left-3 top-5 text-muted"
                    size={15}
                  />
                  <input
                    className={`${field} !pl-9`}
                    aria-label="Shift start time"
                    name="shiftStart"
                    type="time"
                    defaultValue={department?.shiftStart || '09:00'}
                    required
                  />
                </div>
              </label>
              <label className="block text-xs text-muted-strong">
                End Time
                <div className="relative">
                  <Clock3
                    className="pointer-events-none absolute left-3 top-5 text-muted"
                    size={15}
                  />
                  <input
                    className={`${field} !pl-9`}
                    aria-label="Shift end time"
                    name="shiftEnd"
                    type="time"
                    defaultValue={department?.shiftEnd || '17:30'}
                    required
                  />
                </div>
              </label>
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              An end time before the start time represents an overnight shift.
            </p>
          </fieldset>
          <div className="flex items-center gap-3 rounded-xl bg-soft p-3">
            <div className="flex-1">
              <strong className="block text-xs font-semibold">
                Active Status
              </strong>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-strong">
                Employees assigned will be grouped under this department.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-label="Department active status"
              className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${active ? 'bg-primary' : 'bg-slate-300'}`}
              onClick={() => setActive((previous) => !previous)}
            >
              <span
                className={`block size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${active ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-indigo-50/70 p-3 text-[11px] leading-relaxed text-muted-strong">
            <Info size={17} className="mt-0.5 shrink-0 text-primary" />
            <p>
              Employee analytics and application telemetry are aggregated under
              this department. Preview only · No live monitoring settings are
              changed.
            </p>
          </div>
          {error && !nameError && (
            <p className="text-xs text-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 bg-slate-50 px-5 py-4 sm:px-6">
          <button type="button" className="em-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="em-button primary">
            Save Department
          </button>
        </div>
      </form>
    </Modal>
  )
}
