import { test, expect } from '@playwright/test'

test('personal information uses authenticated API writes, survives re-login and preserves edits on failure', async ({
  page,
}) => {
  // These are isolated HTTP fixtures, never a live employee/database mutation.
  let stored = {
    id: 'profile-fixture',
    email: 'admin@example.test',
    role: 'A',
    first_name: 'Initial',
    last_name: 'Person',
    phone: '',
    language: 'en',
    timezone: 'UTC',
    employee_code: 'TEST-ID',
    department_name: null,
    avatar: null,
  }
  let submitted,
    fail = false
  await page.route('https://fonts.googleapis.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
  await page.route('**/api/v1/auth/login', (r) =>
    r.fulfill({
      json: {
        accessToken: 'isolated-test-token',
        refreshToken: 'isolated-refresh-token',
        expiresIn: 900,
      },
    }),
  )
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      json: { user: { id: stored.id, role: 'A', mustChangePassword: false } },
    }),
  )
  await page.route('**/api/v1/profile/notification-preferences', (r) =>
    r.fulfill({
      json: {
        emailDailySummary: false,
        idleAlerts: false,
        emailWeeklyReport: false,
      },
    }),
  )
  await page.route('**/api/v1/profile/login-history?*', (r) =>
    r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  )
  await page.route('**/api/v1/settings/roles', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: [{ role: 'A', permissions: ['profile.manage.self'] }],
      },
    }),
  )
  await page.route('**/api/v1/profile', async (r) => {
    expect(r.request().headers().authorization).toBe(
      'Bearer isolated-test-token',
    )
    if (r.request().method() === 'PUT') {
      submitted = r.request().postDataJSON()
      if (fail)
        return r.fulfill({
          status: 503,
          json: { error: { message: 'Storage unavailable' } },
        })
      stored = {
        ...stored,
        first_name: submitted.firstName,
        last_name: submitted.lastName,
        phone: submitted.phone,
        language: submitted.language,
        timezone: submitted.timezone,
      }
    }
    return r.fulfill({ json: stored })
  })
  async function openProfile() {
    await page.goto('/login')
    await page
      .getByLabel('Email address', { exact: true })
      .fill('admin@example.test')
    await page
      .getByLabel('Password', { exact: true })
      .fill('Fixture-password-123!')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await page
      .locator('header')
      .getByRole('link', { name: 'Open my profile' })
      .click()
    await expect(page.getByLabel('First name', { exact: true })).toBeVisible()
  }
  await openProfile()
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Initial',
  )
  await page.getByLabel('First name', { exact: true }).fill('Saved')
  await page.getByLabel('Last name', { exact: true }).fill('Profile')
  await page.getByLabel('Phone number', { exact: true }).fill('+94112345678')
  await page
    .getByLabel('Preferred language', { exact: true })
    .selectOption('Sinhala')
  await page
    .getByLabel('Time zone', { exact: true })
    .selectOption('Asia/Colombo')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(
    page.getByText('Personal information saved to your account.', {
      exact: true,
    }),
  ).toBeVisible()
  expect(submitted).toEqual({
    firstName: 'Saved',
    lastName: 'Profile',
    phone: '+94112345678',
    language: 'si',
    timezone: 'Asia/Colombo',
  })
  expect(
    await page.evaluate(() =>
      localStorage.getItem('workpulse.profile.draft.v2'),
    ),
  ).toBeNull()
  await page.reload() // Session is restored and profile data is fetched again from the server.
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Saved',
  )
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue(
    '+94112345678',
  )
  fail = true
  await page.getByLabel('First name', { exact: true }).fill('Unsaved edit')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Profile storage is unavailable',
  )
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Unsaved edit',
  )
  expect(stored.first_name).toBe('Saved')
  await expect(
    page.getByText('Personal information saved to your account.', {
      exact: true,
    }),
  ).toHaveCount(0)
})
