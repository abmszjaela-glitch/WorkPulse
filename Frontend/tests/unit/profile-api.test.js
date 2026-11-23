import test from 'node:test'
import assert from 'node:assert/strict'
import {
  profileFromApi,
  personalInformationPayload,
  preferencesFromApi,
} from '../../src/utils/profile.js'

test('maps the actual backend profile row and language codes without a dummy identity', () => {
  const result = profileFromApi(
    {
      id: 'fixture',
      first_name: 'Test',
      last_name: 'Person',
      phone: '+94112345678',
      email: 'test@example.test',
      employee_code: 'ID',
      role: 'A',
      language: 'en',
      timezone: 'UTC',
      department_name: null,
    },
    { emailDailySummary: true },
  )
  assert.equal(result.profile.firstName, 'Test')
  assert.equal(result.profile.language, 'English (United States)')
  assert.equal(result.account.department, '')
  assert.equal(result.account.role, 'Admin')
  assert.equal(result.profile.notifications.daily, true)
  assert.throws(() => profileFromApi({}), /invalid profile/)
})
test('personal update payload includes only editable fields and preserves phone as text', () => {
  const input = {
    firstName: '  Test ',
    lastName: ' Person ',
    phone: ' +94112345678 ',
    language: 'Sinhala',
    timezone: 'Asia/Colombo',
    userId: 'someone-else',
    role: 'A',
    email: 'other@example.test',
    departmentId: 'other',
  }
  assert.deepEqual(personalInformationPayload(input), {
    firstName: 'Test',
    lastName: 'Person',
    phone: '+94112345678',
    language: 'si',
    timezone: 'Asia/Colombo',
  })
  assert.deepEqual(
    preferencesFromApi({
      emailDailySummary: false,
      idleAlerts: true,
      emailWeeklyReport: false,
    }),
    { daily: false, idle: true, weekly: false },
  )
})
