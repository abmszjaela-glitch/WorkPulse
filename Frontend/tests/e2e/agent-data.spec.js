import { test, expect } from '@playwright/test'

// HTTP fixtures exercise rendering/writes only. Production API SQL is exercised
// independently in backend/tests/agent-integration.test.js against PostgreSQL.
const employeeId = '11111111-1111-4111-8111-111111111111'
const departmentId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
const employee = {
  id: employeeId,
  first_name: 'Fixture',
  last_name: 'Employee',
  email: 'fixture@example.test',
  role: 'E',
  employee_code: 'TEST-1',
  department_id: departmentId,
  department_name: 'Fixture Engineering',
  is_active: true,
  device_status: 'connected',
}
const department = {
  id: departmentId,
  name: 'Fixture Engineering',
  description: 'Isolated test team',
  manager_id: null,
  employee_count: 1,
  active_accounts: 1,
  is_active: true,
}
const summary = {
  total_monitored_seconds: 3600,
  active_seconds: 2700,
  idle_seconds: 900,
  record_count: 1,
  productivity_score: null,
}
const app = {
  application_name: 'fixture-editor.exe',
  seconds: 2700,
  users: 1,
  category: 'Productive',
}
const breakdown = {
  total_application_seconds: 2700,
  items: [{ category: 'Productive', seconds: 2700, percentage: 100 }],
}
const pagination = { total: 1, page: 1, pageSize: 20 }

async function setup(page) {
  const writes = [],
    unexpected = [],
    errors = []
  let departments = [department]
  const settings = {
    monitoring: {
      revision: 1,
      idleMinutes: 5,
      evaluationSeconds: 60,
      syncMinutes: 5,
      offlineDays: 7,
      trackApplications: true,
      trackKeyboardCounts: true,
      trackMouseCounts: true,
      pauseOutsideHours: true,
    },
    workingHours: {
      revision: 1,
      configured: true,
      timezone: 'Asia/Colombo',
      schedule: [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ].map((day, i) => ({
        day,
        enabled: i < 5,
        start: '09:00',
        end: '17:30',
      })),
    },
    retention: { revision: 1, retentionDays: 90, requireConsent: true },
    notifications: {
      revision: 1,
      notifyIdle: true,
      notifyAgentOffline: true,
      weeklyDigest: false,
    },
  }
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /same key|unique.*key/i.test(message.text())
    )
      errors.push(message.text())
  })
  await page.route('https://fonts.googleapis.com/**', (r) =>
    r.fulfill({ contentType: 'text/css', body: '' }),
  )
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', ''),
      method = request.method()
    const ok = (value) => route.fulfill({ json: value })
    if (path === '/auth/login')
      return ok({
        accessToken: 'isolated-agent-view-token',
        refreshToken: 'isolated-refresh',
        expiresIn: 900,
      })
    if (path === '/auth/me')
      return ok({
        user: { id: 'admin-fixture', role: 'A', mustChangePassword: false },
      })
    if (path === '/auth/logout') return route.fulfill({ status: 204 })
    expect(request.headers().authorization).toBe(
      'Bearer isolated-agent-view-token',
    )
    if (method !== 'GET') {
      const body = request.postDataJSON()
      writes.push({ path, method, body })
      if (path === '/devices/provision')
        return route.fulfill({
          status: 201,
          json: { deviceId, credential: 'x'.repeat(43) },
        })
      if (path === '/departments' && method === 'POST') {
        departments = [
          ...departments,
          {
            ...department,
            id: '44444444-4444-4444-8444-444444444444',
            name: body.name,
            description: body.description,
          },
        ]
        return route.fulfill({ status: 201, json: departments.at(-1) })
      }
      if (path.startsWith('/settings/')) return ok({ success: true, data: {} })
      if (path === '/app-categories')
        return route.fulfill({
          status: 201,
          json: {
            id: 'rule-fixture',
            application_name: body.applicationName,
            category: body.category,
          },
        })
      if (path.includes('/notifications/'))
        return ok({ success: true, data: {} })
      unexpected.push(method + ' ' + path)
      return route.fulfill({
        status: 400,
        json: { error: { message: 'Unexpected fixture write' } },
      })
    }
    if (path === '/profile')
      return ok({
        ...employee,
        id: 'admin-fixture',
        role: 'A',
        first_name: 'Fixture',
        last_name: 'Admin',
        phone: '',
        language: 'en',
        timezone: 'Asia/Colombo',
        avatar: null,
      })
    if (path === '/profile/notification-preferences')
      return ok({
        emailDailySummary: false,
        idleAlerts: false,
        emailWeeklyReport: false,
      })
    if (path === '/profile/login-history')
      return ok({
        items: [
          {
            id: 'session-fixture',
            created_at: '2026-11-23T07:00:00Z',
            expires_at: '2099-01-01T00:00:00Z',
            revoked_at: null,
            device_id: null,
          },
        ],
        ...pagination,
      })
    if (path === '/employees') return ok({ items: [employee], ...pagination })
    if (path === '/employees/' + employeeId) return ok(employee)
    if (path === '/employees/summary')
      return ok({
        totalEmployees: 1,
        activeAccounts: 1,
        deactivated: 0,
        agentNotInstalled: 0,
      })
    if (path === '/departments')
      return ok({
        items: departments,
        total: departments.length,
        page: 1,
        pageSize: 12,
      })
    if (path === '/dashboard/stats')
      return ok({
        success: true,
        data: {
          total_employees: 1,
          active: 1,
          idle: 0,
          paused: 0,
          offline: 0,
          unknown: 0,
        },
      })
    if (path === '/dashboard/live-status')
      return ok({
        success: true,
        data: [
          { ...employee, status: 'ACTIVE', last_seen: '2026-11-23T07:01:00Z' },
        ],
        pagination,
      })
    if (path === '/dashboard/active-vs-idle')
      return ok({
        success: true,
        data: [{ date: '2026-11-23', active_seconds: 2700, idle_seconds: 900 }],
      })
    if (
      path === '/dashboard/app-usage-summary' ||
      path === '/app-usage/categories-breakdown'
    )
      return ok({ success: true, data: breakdown })
    if (
      path === '/dashboard/top-apps' ||
      path === '/app-usage/top' ||
      path === '/app-usage' ||
      path === '/app-usage/employee/' + employeeId
    )
      return ok({ success: true, data: [app], pagination })
    if (path === '/dashboard/department-productivity')
      return ok({
        success: true,
        data: [{ id: departmentId, name: department.name, ...summary }],
        pagination,
      })
    if (path.endsWith('/summary') && path.startsWith('/activity/'))
      return ok({ success: true, data: summary })
    if (path.endsWith('/timeline'))
      return ok({
        success: true,
        data: [
          {
            timestamp: '2026-11-23T07:00:00Z',
            label: '12:30',
            active_seconds: 2700,
            idle_seconds: 900,
          },
        ],
      })
    if (path.endsWith('/log'))
      return ok({
        success: true,
        data: [
          {
            record_id: 'record-fixture',
            device_id: deviceId,
            interval_start: '2026-11-23T07:00:00Z',
            interval_end: '2026-11-23T08:00:00Z',
            mouse_movements: 1234,
            mouse_clicks: 321,
            key_presses: 456,
            status: 'ACTIVE',
            active_seconds: 2700,
            idle_seconds: 900,
          },
        ],
        pagination,
      })
    if (path.endsWith('/trend'))
      return ok({
        success: true,
        data: [
          {
            date: '2026-11-23',
            active_seconds: 2700,
            idle_seconds: 900,
            productive_seconds: 2700,
            neutral_seconds: 0,
            unproductive_seconds: 0,
            unclassified_seconds: 0,
          },
        ],
      })
    if (path === '/reports/kpis') return ok({ success: true, data: summary })
    if (path === '/reports/charts')
      return ok({
        success: true,
        data: {
          active_vs_idle: [
            { date: '2026-11-23', active_seconds: 2700, idle_seconds: 900 },
          ],
          application_categories: breakdown,
        },
      })
    if (path === '/reports/recent-exports')
      return ok({
        success: true,
        data: [],
        pagination: { ...pagination, total: 0 },
      })
    if (path.startsWith('/reports/export/'))
      return route.fulfill({
        contentType: path.endsWith('/csv') ? 'text/csv' : 'application/pdf',
        body: path.endsWith('/csv')
          ? 'Employee,Active seconds\r\nFixture Employee,2700\r\n'
          : '%PDF-1.4\nFixture export',
      })
    if (path.startsWith('/reports/'))
      return ok({
        success: true,
        data: [
          {
            employee_id: employeeId,
            employee_code: 'TEST-1',
            employee_name: 'Fixture Employee',
            department_name: department.name,
            ...summary,
            top_application: app.application_name,
            observed_activity_days: 1,
          },
        ],
        pagination,
      })
    if (path === '/settings') return ok({ success: true, data: settings })
    if (path === '/settings/roles')
      return ok({
        success: true,
        data: [
          {
            role: 'A',
            name: 'Admin',
            scope: 'organization',
            permissions: ['employees.manage'],
          },
        ],
      })
    if (path === '/consent/policy')
      return ok({
        version: 1,
        content: 'Fixture privacy policy: aggregate counts only.',
      })
    if (path === '/app-categories')
      return ok({ items: [], total: 0, page: 1, pageSize: 20 })
    if (path === '/notifications')
      return ok({
        success: true,
        data: [
          {
            id: 'notice-fixture',
            message: 'Fixture device connected',
            created_at: '2026-11-23T07:00:00Z',
            read_at: null,
          },
        ],
      })
    unexpected.push(method + ' ' + path)
    return route.fulfill({
      status: 404,
      json: { error: { message: 'Unhandled fixture API' } },
    })
  })
  await page.goto('/login')
  await page
    .getByLabel('Email address', { exact: true })
    .fill('admin@example.test')
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic-password-123!')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  return { writes, unexpected, errors }
}

test('all analytics pages render actual API values and employee interval counts without fabricated scores', async ({
  page,
}) => {
  const fixture = await setup(page)
  await expect(
    page.getByRole('cell', { name: 'Fixture Employee fixture@example.test' }),
  ).toBeVisible()
  await expect(
    page.getByText('0h 45m 00s', { exact: true }).first(),
  ).toBeVisible()
  for (const [path, heading, expectedText] of [
    ['/activity-details?employeeId=' + employeeId, 'Activity Details', '1234'],
    ['/application-usage', 'Application Usage', 'fixture-editor.exe'],
    ['/departments', 'Departments', 'Fixture Engineering'],
    ['/reports', 'Reports & Analytics', 'Fixture Employee'],
    [
      '/settings',
      'System Settings',
      'Fixture privacy policy: aggregate counts only.',
    ],
    ['/profile', 'My Profile', 'Fixture Admin'],
  ]) {
    await page.goto(path)
    await expect(
      page
        .locator('header')
        .getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible()
    if (path === '/settings')
      await expect(page.getByLabel('Privacy policy content')).toHaveValue(
        expectedText,
      )
    else
      await expect(
        page
          .getByText(expectedText, { exact: true })
          .filter({ visible: true })
          .first(),
      ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true)
  }
  expect(fixture.errors).toEqual([])
  expect(fixture.unexpected).toEqual([])
})

test('Admin device activation, settings, department creation and report downloads use authorized backend calls', async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.goto('/employees')
  await page
    .getByRole('button', {
      name: 'Connect Agent for Fixture Employee',
      exact: true,
    })
    .click()
  await page.getByRole('button', { name: 'Generate activation code' }).click()
  await expect(page.getByLabel('Agent activation code')).toHaveValue(
    `wp1.${deviceId}.${'x'.repeat(43)}`,
  )
  expect(
    fixture.writes.find((row) => row.path === '/devices/provision').body,
  ).toEqual({ employeeId })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByLabel('Agent activation code')).toHaveCount(0)
  await page.goto('/departments')
  await page
    .getByRole('button', { name: 'Add Department', exact: true })
    .click()
  await page.getByLabel('Name', { exact: true }).fill('New fixture department')
  await page
    .getByLabel('Description', { exact: true })
    .fill('Created through backend fixture')
  await page
    .getByRole('button', { name: 'Save department', exact: true })
    .click()
  await expect(
    page.getByText('New fixture department', { exact: true }),
  ).toBeVisible()
  await page.goto('/settings')
  await page.getByLabel('Idle threshold (minutes)').fill('8')
  await page
    .getByRole('button', { name: 'Save settings', exact: true })
    .first()
    .click()
  await expect
    .poll(
      () =>
        fixture.writes.find((row) => row.path === '/settings/monitoring')?.body
          .idleMinutes,
    )
    .toBe(8)
  await page.goto('/reports')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('WorkPulse-report.csv')
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(page.getByText('Fixture device connected')).toBeVisible()
  expect(fixture.errors).toEqual([])
  expect(fixture.unexpected).toEqual([])
})

test('missing services stay visible without duplicate React keys and scoped exports require a selection', async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.route('**/api/v1/profile/login-history?*', (r) =>
    r.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }),
  )
  await page.route('**/api/v1/settings/roles', (r) =>
    r.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }),
  )
  await page.goto('/profile')
  await expect(page.getByRole('alert')).toHaveCount(2)
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Fixture',
  )
  await page.goto('/reports')
  await page.getByLabel('Report period').selectOption('department')
  await expect(
    page.getByRole('button', { name: 'Export CSV', exact: true }),
  ).toBeDisabled()
  await page.getByLabel('Report department').selectOption(departmentId)
  await expect(
    page.getByRole('button', { name: 'Export CSV', exact: true }),
  ).toBeEnabled()
  expect(fixture.errors).toEqual([])
})
