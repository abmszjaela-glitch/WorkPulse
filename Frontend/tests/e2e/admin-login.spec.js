import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
})

test('root and protected URLs require login; verified Admin login opens dashboard and logout closes it', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: 'Invalid credentials' } },
    }),
  )
  await page
    .getByLabel('Email address', { exact: true })
    .fill('admin@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Test-password-123!')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.')
  await expect(page).toHaveURL(/\/login$/)
  // Synthetic HTTP fixtures are test-only; application code never fakes authentication.
  await page.unroute('**/api/v1/auth/login')
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      json: {
        accessToken: 'test-only-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 900,
      },
    }),
  )
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: { user: { id: 'fixture', role: 'A', mustChangePassword: false } },
    }),
  )
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ status: 204 }),
  )
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(
    page
      .locator('header')
      .getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => localStorage.getItem('accessToken')),
  ).toBeNull()
  const menu = page.getByRole('button', {
    name: 'Open navigation',
    exact: true,
  })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
})

test('non-admin sessions cannot enter admin pages', async ({ page }) => {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      json: {
        accessToken: 'test-only-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 900,
      },
    }),
  )
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { user: { role: 'M' } } }),
  )
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ status: 204 }),
  )
  await page.goto('/login')
  await page
    .getByLabel('Email address', { exact: true })
    .fill('manager@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Test-password-123!')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'An administrator account is required.',
  )
  await expect(page).toHaveURL(/\/login$/)
})
