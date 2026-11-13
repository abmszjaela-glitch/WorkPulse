import { employees } from './dashboard.js'
export const employeeDepartments = [
  'Engineering',
  'Marketing',
  'Design',
  'Sales',
  'Support',
  'HR',
]
export const employeeRoles = ['Admin', 'Manager', 'Employee']
export const managementEmployees = [
  ...employees.map((employee, index) => ({
    ...employee,
    id: ['WP-1001', 'WP-1042', 'WP-1088', 'WP-1104', 'WP-1025', 'WP-1150'][
      index
    ],
    role: ['Admin', 'Manager', 'Employee', 'Employee', 'Manager', 'Employee'][
      index
    ],
    status: 'Active',
    agent:
      index === 3 ? 'Not installed' : index === 4 ? 'Offline' : 'Connected',
    lastActive: index === 3 ? 'Never' : employee.activity,
  })),
  {
    id: 'WP-1012',
    name: 'Thomas Wright',
    email: 'thomas.w@workpulse.io',
    department: 'HR',
    role: 'Admin',
    status: 'Active',
    agent: 'Connected',
    lastActive: '22m ago',
  },
  {
    id: 'WP-1077',
    name: 'Claire Dubois',
    email: 'claire.d@workpulse.io',
    department: 'Marketing',
    role: 'Employee',
    status: 'Deactivated',
    agent: 'Offline',
    lastActive: '14d ago',
  },
]
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
