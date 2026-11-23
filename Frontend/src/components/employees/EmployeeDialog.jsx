import Modal from '../ui/Modal.jsx'
import { useState } from 'react'
import {
  Check,
  Eye,
  EyeOff,
  Info,
  RefreshCw,
  TriangleAlert,
  Unplug,
  UserRoundX,
  X,
} from 'lucide-react'
import { employeeRoles } from '../../data/employees.js'

function generatePassword() {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&*',
  ]
  const pick = (characters) => {
    const range = 256 - (256 % characters.length)
    const value = new Uint8Array(1)
    do {
      crypto.getRandomValues(value)
    } while (value[0] >= range)
    return characters[value[0] % characters.length]
  }
  const password = groups.map(pick)
  while (password.length < 16) password.push(pick(groups.join('')))
  for (let index = password.length - 1; index > 0; index--) {
    const random = new Uint32Array(1)
    crypto.getRandomValues(random)
    const other = random[0] % (index + 1)
    ;[password[index], password[other]] = [password[other], password[index]]
  }
  return password.join('')
}

export default function EmployeeDialog({
  modal,
  departments = [],
  onClose,
  onSave,
  onBulk,
}) {
  const [error, setError] = useState(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const active = modal.employee?.status !== 'Deactivated'
  const view = modal.type === 'view'
  const bulk = modal.type === 'department'
  const deactivate = modal.type === 'deactivate'
  const employee = modal.employee
  const targets = modal.targets || []
  const close = () => {
    if (!saving) onClose()
  }
  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    if (
      !employee &&
      !bulk &&
      !deactivate &&
      (password.length < 12 ||
        new TextEncoder().encode(password).length > 72 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[^a-zA-Z0-9]/.test(password))
    ) {
      setError({
        message:
          'Use a password of at least 12 characters with uppercase, lowercase, a number and a symbol (maximum 72 bytes).',
      })
      return
    }
    setError(null)
    setSaving(true)
    try {
      const message =
        bulk || deactivate
          ? await onBulk(values.departmentId)
          : await onSave({ ...values, password }, employee?.id)
      if (message) setError(message)
      else {
        setPassword('')
        onClose()
      }
    } catch {
      setError({
        message: 'The employee could not be saved. Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }
  const title = view
    ? 'Employee details'
    : bulk
      ? 'Change department'
      : deactivate
        ? `Deactivate employee${targets.length > 1 ? 's' : ''}?`
        : employee
          ? 'Edit Employee'
          : 'Add New Employee'
  return (
    <Modal
      onClose={close}
      className={`employee-dialog ${deactivate ? 'deactivate-dialog' : ''}`}
      titleId="employee-dialog-title"
      descriptionId="employee-dialog-description"
    >
      {deactivate && (
        <div className="deactivate-symbol">
          <TriangleAlert size={25} />
        </div>
      )}
      <div className="dialog-heading">
        <h2 id="employee-dialog-title">{title}</h2>
        <button
          className="icon-button dialog-close"
          onClick={close}
          disabled={saving}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
      </div>
      <p className="dialog-description" id="employee-dialog-description">
        {view || bulk
          ? 'Employee details are loaded from the database.'
          : deactivate
            ? ''
            : 'Enter employee details and assign initial department permissions.'}
      </p>
      {view ? (
        <>
          <dl className="employee-details">
            {[
              ['Name', employee.name],
              ['Email', employee.email],
              ['Employee ID', employee.employeeCode],
              ['Department', employee.department],
              ['Role', employee.role],
              [
                'Manager',
                employee.departmentId
                  ? 'Managed through the department'
                  : 'Not assigned',
              ],
              ['Phone', employee.phone || 'Not provided'],
              ['Device / agent', employee.agent],
              ['Status', employee.status],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <button className="em-button primary" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={saving}>
            {deactivate ? (
              <>
                <div className="deactivate-targets">
                  {targets.map((target) => (
                    <div key={target.id}>
                      <span>
                        {target.name
                          .split(' ')
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <p>
                        <strong>{target.name}</strong> · {target.employeeCode} (
                        {target.department})
                      </p>
                    </div>
                  ))}
                </div>
                <p className="deactivate-explanation">
                  {targets.length > 1 ? 'These employees' : 'This employee'}{' '}
                  will be marked as deactivated. Their past data will be kept.
                </p>
                <div className="deactivate-agent-warning">
                  <Unplug size={16} />
                  <span>
                    Deactivation blocks sign-in and authorized device
                    submissions.
                  </span>
                </div>
                <p className="dialog-preview-note">
                  This changes the selected accounts in the database.
                </p>
              </>
            ) : bulk ? (
              <label className="em-field">
                New department
                <select
                  name="departmentId"
                  aria-label="New department"
                  defaultValue=""
                >
                  <option value="">Unassigned</option>
                  {departments
                    .filter((row) => row.is_active)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <>
                <div className="employee-form-grid">
                  <label className="em-field">
                    First name
                    <input
                      name="firstName"
                      defaultValue={employee?.firstName}
                      required
                      maxLength={100}
                      autoComplete="given-name"
                      placeholder="First name"
                    />
                  </label>
                  <label className="em-field">
                    Last name
                    <input
                      name="lastName"
                      defaultValue={employee?.lastName}
                      required
                      maxLength={100}
                      autoComplete="family-name"
                      placeholder="Last name"
                    />
                  </label>
                  <label className="em-field">
                    Email address
                    <input
                      name="email"
                      aria-label="Email address"
                      type="email"
                      defaultValue={employee?.email}
                      required
                      maxLength={254}
                      autoComplete="email"
                      placeholder="Employee email address"
                      aria-invalid={error?.field === 'email'}
                      aria-describedby={
                        error?.field === 'email'
                          ? 'employee-email-error'
                          : undefined
                      }
                      onChange={() => setError(null)}
                    />
                    {error?.field === 'email' && (
                      <span
                        id="employee-email-error"
                        className="em-form-error"
                        role="alert"
                      >
                        <TriangleAlert size={12} />
                        {error.message}
                      </span>
                    )}
                  </label>
                  <label className="em-field">
                    Phone number
                    <input
                      name="phone"
                      type="tel"
                      defaultValue={employee?.phone}
                      autoComplete="tel"
                      maxLength={32}
                      placeholder="Phone number"
                    />
                  </label>
                  <label className="em-field">
                    Employee ID
                    <input
                      name="employeeCode"
                      aria-label="Employee ID"
                      defaultValue={employee?.employeeCode}
                      placeholder="Employee ID"
                      required
                      maxLength={64}
                      aria-invalid={error?.field === 'id'}
                      onChange={() => setError(null)}
                    />
                    {error?.field === 'id' && (
                      <span className="em-form-error" role="alert">
                        {error.message}
                      </span>
                    )}
                  </label>
                  <label className="em-field">
                    Department
                    <select
                      name="departmentId"
                      aria-label="Department"
                      defaultValue={employee?.departmentId || ''}
                    >
                      <option value="">Unassigned</option>
                      {departments
                        .filter(
                          (row) =>
                            row.is_active || row.id === employee?.departmentId,
                        )
                        .map((row) => (
                          <option
                            key={row.id}
                            value={row.id}
                            disabled={!row.is_active}
                          >
                            {row.name}
                            {!row.is_active ? ' (inactive)' : ''}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="em-field">
                    Role
                    <select
                      name="role"
                      aria-label="Role"
                      defaultValue={employee?.role || 'Employee'}
                    >
                      {employeeRoles.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="em-field">
                    Manager
                    <select aria-label="Manager" disabled>
                      <option>Managed through the department</option>
                    </select>
                  </label>
                </div>
                {!employee && (
                  <div className="temporary-password">
                    <div>
                      <label htmlFor="temporary-password">
                        Temporary Password
                      </label>
                      <button
                        type="button"
                        onClick={() => setPassword(generatePassword())}
                      >
                        <RefreshCw size={12} />
                        Generate
                      </button>
                    </div>
                    <div className="temporary-password-input">
                      <input
                        id="temporary-password"
                        name="temporaryPassword"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={12}
                        required
                        autoComplete="new-password"
                        placeholder="Generate a temporary password"
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword
                            ? 'Hide temporary password'
                            : 'Show temporary password'
                        }
                        onClick={() => setShowPassword((previous) => !previous)}
                      >
                        {showPassword ? (
                          <EyeOff size={17} />
                        ) : (
                          <Eye size={17} />
                        )}
                      </button>
                    </div>
                    <small>
                      Used to create this account. The server stores a bcrypt
                      hash; the employee must change the temporary password on
                      first login.
                    </small>
                  </div>
                )}
                <div className="account-status-control">
                  <div>
                    <strong>Account Status</strong>
                    <p>
                      {employee
                        ? 'Use directory actions to activate or deactivate this account.'
                        : 'New accounts are active. Use Deactivate after creation if needed.'}
                    </p>
                  </div>
                  <span>{active ? 'Active' : 'Inactive'}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    aria-label="Account active"
                    className={`status-switch ${active ? 'on' : ''}`}
                    disabled
                  >
                    <span />
                  </button>
                </div>
                <div className="agent-install-note">
                  <Info size={18} />
                  <p>
                    The WorkPulse agent must be installed on the employee’s PC.
                    Monitoring starts after the employee gives consent.
                  </p>
                </div>
              </>
            )}
            {error && !error.field && (
              <p className="em-form-error" role="alert">
                {error.message}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="em-button" onClick={onClose}>
                Cancel
              </button>
              <button
                className={`em-button ${deactivate ? 'danger-solid' : 'primary'}`}
                type="submit"
                disabled={saving}
              >
                {deactivate ? (
                  <>
                    <UserRoundX size={16} />
                    Deactivate
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    {saving
                      ? 'Saving…'
                      : bulk
                        ? 'Save changes'
                        : 'Save Employee'}
                  </>
                )}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  )
}
