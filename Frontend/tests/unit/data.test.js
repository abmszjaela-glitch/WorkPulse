import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initialDepartments,
  departmentSummary,
  removeDepartment,
  validateDepartment,
} from '../../src/data/departments.js'
import {
  hourlyActivity,
  activityLogs,
  activityEmployee,
  activityApps,
  activityTrend,
  timeDistribution,
  filterActivityLogs,
  activityLogsCsv,
} from '../../src/data/activity.js'
import {
  trackedApplications,
  usageRecords,
  summarizeApplications,
  getCategoryTotals,
  getUsageTrend,
} from '../../src/data/applicationUsage.js'
import {
  employees,
  applications,
  departments,
  weeklyActivity,
} from '../../src/data/dashboard.js'
import {
  managementEmployees,
  employeeDepartments,
} from '../../src/data/employees.js'
import {
  buildReport,
  reportChartData,
  reportCsv,
} from '../../src/data/reports.js'
import {
  defaultSettings,
  cloneSettings,
  loadSettings,
  shiftHours,
  validateSettings,
} from '../../src/data/settings.js'
import {
  copyProfile,
  defaultProfile,
  profileAccount,
  loadProfile,
  validatePasswordChange,
  validateProfile,
} from '../../src/data/profile.js'

test('runtime datasets contain no seeded people, applications, logs or chart points', () => {
  for (const rows of [
    initialDepartments,
    hourlyActivity,
    activityLogs,
    activityApps,
    activityTrend,
    timeDistribution,
    trackedApplications,
    usageRecords,
    employees,
    applications,
    departments,
    weeklyActivity,
    managementEmployees,
    employeeDepartments,
  ])
    assert.deepEqual(rows, [])
  assert.equal(activityEmployee.id, '')
  for (const value of Object.values(profileAccount)) assert.equal(value, '')
})
test('department reassignment conserves supplied counts without inventing a score', () => {
  const before = [
    {
      id: 'one',
      name: 'First team',
      employees: 2,
      active: 1,
      avgMinutes: 10,
      status: 'Active',
    },
    {
      id: 'two',
      name: 'Second team',
      employees: 3,
      active: 2,
      avgMinutes: 20,
      status: 'Active',
    },
  ]
  const original = structuredClone(before),
    next = removeDepartment(before, 'one', 'two')
  assert.equal(departmentSummary(next).employees, 5)
  assert.equal(departmentSummary(next).active, 3)
  assert.equal(departmentSummary(next).productivity, null)
  assert.deepEqual(before, original)
  assert.throws(() => removeDepartment(before, 'one', 'one'))
  assert.ok(validateDepartment({ name: 'First team' }, before))
})
test('activity filtering and CSV use supplied records only', () => {
  const rows = [
    {
      range: '09:00',
      status: 'Active',
      app: 'test.exe',
      context: '',
      mouse: 1,
      keys: 2,
      duration: '1m',
    },
    {
      range: '09:01',
      status: 'Idle',
      app: '',
      context: '',
      mouse: 0,
      keys: 0,
      duration: '1m',
    },
  ]
  const filtered = filterActivityLogs(rows, 'test.exe', 'Active')
  assert.equal(filtered.length, 1)
  assert.equal(activityLogsCsv(filtered).split('\r\n').length, 2)
  assert.equal(activityLogsCsv([]).split('\r\n').length, 1)
})
test('empty application data does not produce fabricated trends or records', () => {
  assert.deepEqual(
    summarizeApplications(trackedApplications, { period: 'today' }),
    [],
  )
  assert.deepEqual(getUsageTrend([], 0, 7), [])
  const categories = getCategoryTotals([
    { category: 'Productive', totalMinutes: 2 },
  ])
  assert.equal(categories[0].minutes, 2)
  assert.equal(categories[1].minutes, 0)
})
test('reports stay unavailable instead of generating synthetic ratios or chart points', () => {
  const report = buildReport()
  assert.deepEqual(report.rows, [])
  assert.deepEqual(report.groups, [])
  for (const key of [
    'productivity',
    'attendance',
    'overtime',
    'activeMinutes',
    'idleMinutes',
    'totalMinutes',
  ])
    assert.equal(report[key], null)
  assert.deepEqual(reportChartData(report, 7), [])
  assert.equal(reportCsv(report.rows).split('\r\n').length, 1)
})
test('settings have no seeded rules or policy and ignore old preview storage', () => {
  assert.deepEqual(defaultSettings.rules, [])
  assert.equal(defaultSettings.policy, '')
  assert.ok(defaultSettings.schedule.every((day) => !day.enabled))
  assert.equal(shiftHours('22:00', '06:00'), 8)
  const valid = cloneSettings()
  valid.policy = 'Policy entered by the user'
  assert.equal(validateSettings(valid), null)
  valid.rules = [
    {
      id: 'one',
      name: 'test.exe',
      category: 'Neutral',
      scope: 'All Departments',
    },
    {
      id: 'two',
      name: 'test.exe',
      category: 'Neutral',
      scope: 'All Departments',
    },
  ]
  assert.ok(validateSettings(valid))
  assert.deepEqual(
    loadSettings({
      getItem: (key) =>
        key.includes('.preview.')
          ? JSON.stringify({ rules: [{ name: 'Old rule' }] })
          : null,
    }).settings.rules,
    [],
  )
  assert.ok(loadSettings({ getItem: () => '{broken' }).notice)
})
test('profile starts blank and ignores old preview identity while validating input', () => {
  assert.equal(defaultProfile.firstName, '')
  assert.equal(defaultProfile.lastName, '')
  assert.equal(defaultProfile.phone, '')
  const profile = copyProfile()
  profile.firstName = 'Test'
  profile.lastName = 'Person'
  assert.equal(validateProfile(profile), null)
  assert.equal(
    loadProfile({
      getItem: (key) =>
        key.includes('.preview.')
          ? JSON.stringify({ ...profile, firstName: 'Seeded' })
          : null,
    }).profile.firstName,
    '',
  )
  assert.ok(
    loadProfile({
      getItem: () => {
        throw new Error('Denied')
      },
    }).error,
  )
  assert.ok(
    validatePasswordChange('OldPassword1!', 'NewPassword2!', 'Mismatch'),
  )
  assert.ok(!Object.keys(defaultProfile).some((key) => /password/i.test(key)))
})
