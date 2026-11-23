import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeFromApi, employeePayload } from '../../src/utils/employees.js'

test('employee UUID stays distinct from the visible employee code and device state is not invented', () => {
  const row = employeeFromApi({
    id: 'internal-id',
    employee_code: 'TEST-ID',
    first_name: 'Test',
    last_name: 'Person',
    email: 'test@example.test',
    role: 'E',
    is_active: true,
    agent_installed: true,
    department_id: null,
  })
  assert.equal(row.id, 'internal-id')
  assert.equal(row.employeeCode, 'TEST-ID')
  assert.equal(row.role, 'Employee')
  assert.equal(row.agent, 'Installed')
  assert.equal(row.lastActive, 'No activity received')
})
test('create payload includes the actual password and maps department/role fields to the backend contract', () => {
  const data = {
    firstName: ' Test ',
    lastName: ' Person ',
    employeeCode: ' TEST-ID ',
    email: 'USER@EXAMPLE.TEST ',
    phone: ' +94112345678 ',
    departmentId: 'department-id',
    role: 'Employee',
    password: 'Exact password 123!',
  }
  assert.deepEqual(employeePayload(data), {
    firstName: 'Test',
    lastName: 'Person',
    employeeCode: 'TEST-ID',
    email: 'user@example.test',
    phone: '+94112345678',
    departmentId: 'department-id',
    role: 'E',
    password: 'Exact password 123!',
    temporary: true,
  })
  assert.equal(
    employeePayload({ ...data, departmentId: '' }).departmentId,
    null,
  )
})
test('editing personal fields does not send unchanged credentials/role or accidentally revoke sessions', () => {
  const original = employeeFromApi({
    id: 'internal-id',
    employee_code: 'TEST-ID',
    first_name: 'Test',
    last_name: 'Person',
    email: 'test@example.test',
    phone: '',
    role: 'A',
    is_active: true,
  })
  const data = {
    firstName: 'Changed',
    lastName: 'Person',
    employeeCode: 'TEST-ID',
    email: 'test@example.test',
    phone: '',
    role: 'Admin',
    departmentId: '',
  }
  assert.deepEqual(employeePayload(data, original), { firstName: 'Changed' })
})
