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
  filterActivityLogs,
  activityLogsCsv,
} from '../../src/data/activity.js'
import {
  trackedApplications,
  summarizeApplications,
  getCategoryTotals,
} from '../../src/data/applicationUsage.js'
import { buildReport, reportCsv } from '../../src/data/reports.js'
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
  loadProfile,
  validatePasswordChange,
  validateProfile,
} from '../../src/data/profile.js'

test('department reassignment preserves employee and active totals without mutation', () => {
  const before = structuredClone(initialDepartments)
  const next = removeDepartment(before, 'support', 'engineering')
  assert.equal(
    departmentSummary(next).employees,
    departmentSummary(before).employees,
  )
  assert.equal(departmentSummary(next).active, departmentSummary(before).active)
  assert.equal(next.find((row) => row.id === 'engineering').employees, 60)
  assert.deepEqual(before, initialDepartments)
  assert.throws(() => removeDepartment(before, 'support', 'support'))
  assert.ok(validateDepartment({ name: 'Engineering' }, before))
  assert.ok(
    validateDepartment(
      { name: 'Night', shiftStart: '09:00', shiftEnd: '09:00' },
      before,
    ),
  )
})
test('activity intervals total one hour and filters/CSV agree', () => {
  assert.ok(
    hourlyActivity.every((row) => row.active + row.idle + row.offline === 60),
  )
  assert.equal(
    hourlyActivity.reduce((sum, row) => sum + row.active, 0),
    378,
  )
  const filtered = filterActivityLogs(activityLogs, 'Slack', 'Active')
  assert.ok(filtered.every((row) => row.app === 'Slack'))
  assert.equal(
    activityLogsCsv(filtered).split('\r\n').length,
    filtered.length + 1,
  )
})
test('application scope and recategorization recompute totals and shares', () => {
  const filters = {
    period: 'today',
    department: '',
    employee: '',
    category: '',
  }
  const all = summarizeApplications(trackedApplications, filters)
  assert.ok(
    Math.abs(all.reduce((sum, app) => sum + app.share, 0) - 100) < 0.001,
  )
  assert.ok(
    summarizeApplications(trackedApplications, {
      ...filters,
      employee: 'WP-1001',
    }).every((app) => app.users === 1),
  )
  assert.equal(
    summarizeApplications(trackedApplications, {
      ...filters,
      department: 'Design',
      employee: 'WP-1001',
    }).length,
    0,
  )
  const categories = getCategoryTotals(
    summarizeApplications(
      trackedApplications.map((app) => ({ ...app, category: 'Productive' })),
      filters,
    ),
  )
  assert.equal(categories[1].minutes + categories[2].minutes, 0)
})
test('report aggregates, absence and exports stay internally consistent', () => {
  const report = buildReport()
  assert.equal(report.totalMinutes, report.activeMinutes + report.idleMinutes)
  assert.equal(report.rows.length, 8)
  assert.equal(buildReport({ department: 'Engineering' }).rows.length, 2)
  assert.equal(buildReport({ department: 'missing' }).productivity, 0)
  assert.equal(
    buildReport({ days: 1 }).rows.find((row) => !row.present).totalMinutes,
    0,
  )
  assert.equal(reportCsv(report.rows).split('\r\n').length, 9)
})
test('settings validate shifts and reject corrupt storage and duplicate rules', () => {
  assert.equal(validateSettings(defaultSettings), null)
  assert.equal(shiftHours('22:00', '06:00'), 8)
  const invalid = cloneSettings()
  invalid.rules.push({ ...invalid.rules[0], id: 'duplicate' })
  assert.ok(validateSettings(invalid))
  assert.ok(loadSettings({ getItem: () => 'broken' }).notice)
  assert.deepEqual(
    loadSettings({ getItem: () => JSON.stringify(defaultSettings) }).settings,
    defaultSettings,
  )
})
test('profile validation, persistence recovery and password checks never store credentials', () => {
  assert.equal(validateProfile(defaultProfile), null)
  const invalid = copyProfile()
  invalid.photo = 'https://example.com/photo.png'
  assert.ok(validateProfile(invalid))
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
  assert.equal(
    validatePasswordChange('OldPassword1!', 'NewPassword2!', 'NewPassword2!'),
    null,
  )
  assert.ok(!Object.keys(defaultProfile).some((key) => /password/i.test(key)))
})
