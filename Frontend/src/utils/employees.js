export const employeeRoleCodes = { Admin: 'A', Manager: 'M', Employee: 'E' }
export function employeeFromApi(row) {
  return {
    id: row.id,
    employeeCode: row.employee_code || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    name:
      [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
    email: row.email,
    phone: row.phone || '',
    department: row.department_name || 'Unassigned',
    departmentId: row.department_id || '',
    role: { A: 'Admin', M: 'Manager', E: 'Employee' }[row.role] || row.role,
    status: row.is_active ? 'Active' : 'Deactivated',
    agent: row.agent_installed ? 'Installed' : 'Not installed',
    lastActive: row.last_seen
      ? new Date(row.last_seen).toLocaleString()
      : 'No activity received',
  }
}
export function employeePayload(data, original) {
  const values = {
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    email: data.email.trim().toLowerCase(),
    phone: (data.phone || '').trim(),
    employeeCode: data.employeeCode.trim(),
    departmentId: data.departmentId || null,
    role: employeeRoleCodes[data.role],
  }
  if (!original) return { ...values, password: data.password, temporary: true }
  const previous = {
    firstName: original.firstName,
    lastName: original.lastName,
    email: original.email,
    phone: original.phone,
    employeeCode: original.employeeCode,
    departmentId: original.departmentId || null,
    role: employeeRoleCodes[original.role],
  }
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => value !== previous[key]),
  )
}
