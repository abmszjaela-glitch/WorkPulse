import { useEffect, useRef, useState } from 'react'
import { Check, Eye, EyeOff, Info, RefreshCw, TriangleAlert, Unplug, UserRoundX, X } from 'lucide-react'
import { employeeDepartments, employeeRoles } from '../../data/employees.js'

function generatePassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*']
  const pick = (characters) => {
    const range = 256 - (256 % characters.length)
    const value = new Uint8Array(1)
    do { crypto.getRandomValues(value) } while (value[0] >= range)
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

export default function EmployeeDialog({ modal, employees, onClose, onSave, onBulk }) {
  const dialog = useRef(null)
  const [error, setError] = useState(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [active, setActive] = useState(modal.employee?.status !== 'Deactivated')
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  const view = modal.type === 'view'
  const bulk = modal.type === 'department'
  const deactivate = modal.type === 'deactivate'
  const employee = modal.employee
  const targets = modal.targets || []
  const submit = (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const { temporaryPassword: ignoredPassword, ...profile } = values
    void ignoredPassword
    const data = { ...profile, name: `${values.firstName || ''} ${values.lastName || ''}`.trim(), status: active ? 'Active' : 'Deactivated' }
    delete data.firstName
    delete data.lastName
    const message = bulk || deactivate ? onBulk(values.department) : onSave(data, employee?.id)
    if (message) setError(message)
    else onClose()
  }
  const title = view ? 'Employee details' : bulk ? 'Change department' : deactivate ? `Deactivate employee${targets.length > 1 ? 's' : ''}?` : employee ? 'Edit Employee' : 'Add New Employee'
  return <dialog ref={dialog} className={`employee-dialog ${deactivate ? 'deactivate-dialog' : ''}`} onCancel={onClose} aria-labelledby="employee-dialog-title" aria-describedby="employee-dialog-description">
    {deactivate && <div className="deactivate-symbol"><TriangleAlert size={25} /></div>}
    <div className="dialog-heading"><h2 id="employee-dialog-title">{title}</h2><button className="icon-button dialog-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>
    <p className="dialog-description" id="employee-dialog-description">{view || bulk ? 'Changes apply to this preview session only.' : deactivate ? '' : 'Enter employee details and assign initial department permissions.'}</p>
    {view ? <><dl className="employee-details">{[['Name', employee.name], ['Email', employee.email], ['Employee ID', employee.id], ['Department', employee.department], ['Role', employee.role], ['Manager', employees.find((row) => row.id === employee.manager)?.name || 'Not assigned'], ['Phone', employee.phone || 'Not provided'], ['Device / agent', employee.agent], ['Status', employee.status]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><button className="em-button primary" onClick={onClose}>Done</button></> : <form onSubmit={submit}>
      {deactivate ? <>
        <div className="deactivate-targets">{targets.map((target) => <div key={target.id}><span>{target.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><p><strong>{target.name}</strong> · {target.id} ({target.department})</p></div>)}</div>
        <p className="deactivate-explanation">{targets.length > 1 ? 'These employees' : 'This employee'} will be marked as deactivated. Their past data will be kept.</p>
        <div className="deactivate-agent-warning"><Unplug size={16} /><span>In production, deactivation must also block sign-in and disconnect the desktop agent.</span></div>
        <p className="dialog-preview-note">Preview only · No live accounts or agents are affected.</p>
      </> : bulk ? <label className="em-field">New department<select name="department" required>{employeeDepartments.map((value) => <option key={value}>{value}</option>)}</select></label> : <>
        <div className="employee-form-grid">
          <label className="em-field">First name<input name="firstName" defaultValue={employee?.name.split(' ')[0]} required maxLength={50} autoComplete="given-name" placeholder="Jonathan" /></label>
          <label className="em-field">Last name<input name="lastName" defaultValue={employee?.name.split(' ').slice(1).join(' ')} required maxLength={50} autoComplete="family-name" placeholder="Miller" /></label>
          <label className="em-field">Email address<input name="email" type="email" defaultValue={employee?.email} required maxLength={200} autoComplete="email" placeholder="j.miller@workpulse.io" aria-invalid={error?.field === 'email'} aria-describedby={error?.field === 'email' ? 'employee-email-error' : undefined} onChange={() => setError(null)} />{error?.field === 'email' && <span id="employee-email-error" className="em-form-error" role="alert"><TriangleAlert size={12} />{error.message}</span>}</label>
          <label className="em-field">Phone number<input name="phone" type="tel" defaultValue={employee?.phone} autoComplete="tel" maxLength={40} placeholder="+1 (555) 382-9102" /></label>
          <label className="em-field">Employee ID<input name="id" defaultValue={employee?.id} placeholder="WP-1129" required maxLength={30} aria-invalid={error?.field === 'id'} onChange={() => setError(null)} />{error?.field === 'id' && <span className="em-form-error" role="alert">{error.message}</span>}</label>
          <label className="em-field">Department<select name="department" defaultValue={employee?.department || 'Engineering'}>{employeeDepartments.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="em-field">Role<select name="role" defaultValue={employee?.role || 'Employee'}>{employeeRoles.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="em-field">Manager<select name="manager" defaultValue={employee?.manager || ''}><option value="">Not assigned</option>{employees.filter((row) => row.id !== employee?.id && row.status === 'Active' && ['Admin', 'Manager'].includes(row.role)).map((row) => <option key={row.id} value={row.id}>{row.name} ({row.id})</option>)}</select></label>
        </div>
        {!employee && <div className="temporary-password"><div><label htmlFor="temporary-password">Temporary Password</label><button type="button" onClick={() => setPassword(generatePassword())}><RefreshCw size={12} />Generate</button></div><div className="temporary-password-input"><input id="temporary-password" name="temporaryPassword" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} autoComplete="new-password" placeholder="Generate a temporary password" /><button type="button" aria-label={showPassword ? 'Hide temporary password' : 'Show temporary password'} onClick={() => setShowPassword((previous) => !previous)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small>Preview only. This password is not saved or used to create credentials.</small></div>}
        <div className="account-status-control"><div><strong>Account Status</strong><p>{active ? 'Active immediately upon provisioning' : 'Account will be deactivated'}</p></div><span>{active ? 'Active' : 'Inactive'}</span><button type="button" role="switch" aria-checked={active} aria-label="Account active" className={`status-switch ${active ? 'on' : ''}`} onClick={() => setActive((previous) => !previous)}><span /></button></div>
        <div className="agent-install-note"><Info size={18} /><p>The WorkPulse agent must be installed on the employee’s PC. Monitoring starts after the employee gives consent.</p></div>
      </>}
      {error && !error.field && <p className="em-form-error" role="alert">{error.message}</p>}
      <div className="dialog-actions"><button type="button" className="em-button" onClick={onClose}>Cancel</button><button className={`em-button ${deactivate ? 'danger-solid' : 'primary'}`} type="submit">{deactivate ? <><UserRoundX size={16} />Deactivate</> : <><Check size={16} />{bulk ? 'Save changes' : 'Save Employee'}</>}</button></div>
    </form>}
  </dialog>
}
