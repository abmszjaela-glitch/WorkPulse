export const employeeDepartments = []
export const employeeRoles = ['Admin', 'Manager', 'Employee']
export const managementEmployees = []
export function filterEmployees(rows, search, department, role, status) {
  const term = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      `${row.name} ${row.email} ${row.id} ${row.role} ${row.department}`
        .toLowerCase()
        .includes(term) &&
      (!department || row.department === department) &&
      (!role || row.role === role) &&
      (!status || row.status === status),
  )
}
export function employeeCsv(rows) {
  const fields = [
    'id',
    'name',
    'email',
    'department',
    'role',
    'agent',
    'lastActive',
    'status',
  ]
  const escape = (value) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`
  return [fields, ...rows.map((row) => fields.map((field) => row[field]))]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
}
