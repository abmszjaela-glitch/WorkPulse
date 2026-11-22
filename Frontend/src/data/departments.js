export const initialDepartments = []
export function filterDepartments(rows, search, status, managers = []) {
  const term = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!status || row.status === status) &&
      `${row.name} ${row.description} ${managers.find((person) => person.id === row.managerId)?.name || ''}`
        .toLowerCase()
        .includes(term),
  )
}
export function departmentSummary(rows) {
  const employees = rows.reduce((sum, row) => sum + row.employees, 0)
  return {
    departments: rows.length,
    employees,
    active: rows.reduce(
      (sum, row) => sum + (row.status === 'Active' ? row.active : 0),
      0,
    ),
    productivity: null,
  }
}
export function validateDepartment(data, rows, originalId) {
  if (!data.name?.trim()) return 'Department name is required.'
  if (data.name.trim().length > 80)
    return 'Department name must be 80 characters or fewer.'
  if (
    rows.some(
      (row) =>
        row.id !== originalId &&
        row.name.trim().toLowerCase() === data.name.trim().toLowerCase(),
    )
  )
    return 'A department with this name already exists.'
  if (data.shiftStart !== undefined || data.shiftEnd !== undefined) {
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/
    if (!validTime.test(data.shiftStart) || !validTime.test(data.shiftEnd))
      return 'Enter valid shift start and end times.'
    if (data.shiftStart === data.shiftEnd)
      return 'Shift start and end times must be different.'
  }
  return null
}
export function departmentCsv(rows, managers) {
  const escape = (value) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`
  return [
    [
      'Department',
      'Description',
      'Manager',
      'Employees',
      'Active now',
      'Average active time',
      'Productivity',
      'Status',
    ],
    ...rows.map((row) => [
      row.name,
      row.description,
      managers.find((person) => person.id === row.managerId)?.name ||
        'Unassigned',
      row.employees,
      row.status === 'Active' ? row.active : 0,
      `${Math.floor(row.avgMinutes / 60)}h ${row.avgMinutes % 60}m`,
      row.productivity == null ? 'Unavailable' : `${row.productivity}%`,
      row.status,
    ]),
  ]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
}

export function removeDepartment(rows, id, targetId) {
  const source = rows.find((row) => row.id === id)
  if (!source) throw new Error('Department no longer exists.')
  if (source.employees > 0) {
    const target = rows.find(
      (row) => row.id === targetId && row.id !== id && row.status === 'Active',
    )
    if (!target)
      throw new Error('Select another active department to reassign employees.')
    const count = source.employees + target.employees
    return rows
      .filter((row) => row.id !== id)
      .map((row) =>
        row.id === targetId
          ? {
              ...row,
              employees: count,
              active:
                row.active + (source.status === 'Active' ? source.active : 0),
              productivity: null,
              avgMinutes: Math.round(
                (row.avgMinutes * row.employees +
                  source.avgMinutes * source.employees) /
                  count,
              ),
            }
          : row,
      )
  }
  return rows.filter((row) => row.id !== id)
}
