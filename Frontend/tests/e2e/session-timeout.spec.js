import { test, expect } from '@playwright/test'

const key = 'workpulse.admin.session.v1'
async function fixtures(page, { expiresIn = 900 } = {}) {
  const calls = { me: 0, refresh: 0, logout: 0, reject: false }
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      json: {
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresIn,
      },
    }),
  )
  await page.route('**/api/v1/auth/me', (route) => {
    calls.me++
    return route.fulfill(
      calls.reject
        ? { status: 401, json: { error: { message: 'Invalid token' } } }
        : {
            json: {
              user: { id: 'fixture', role: 'A', mustChangePassword: false },
            },
          },
    )
  })
  await page.route('**/api/v1/auth/refresh', (route) => {
    calls.refresh++
    return route.fulfill({
      json: {
        accessToken: 'renewed-access',
        refreshToken: 'renewed-refresh',
        expiresIn: 900,
      },
    })
  })
  await page.route('**/api/v1/auth/logout', (route) => {
    calls.logout++
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/v1/profile', (route) =>
    route.fulfill({
      json: {
        id: 'fixture',
        first_name: 'Test',
        last_name: 'Admin',
        role: 'A',
        language: 'en',
        timezone: 'UTC',
      },
    }),
  )
  await page.route('**/api/v1/profile/notification-preferences', (route) =>
    route.fulfill({ json: {} }),
  )
  return calls
}
async function signIn(page) {
  await page.goto('/login')
  await page
    .getByLabel('Email address', { exact: true })
    .fill('admin@example.test')
  await page
    .getByLabel('Password', { exact: true })
    .fill('Fixture-password-123!')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(
    page
      .locator('header')
      .getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible()
}

test('refresh restores a verified session and keeps the protected URL', async ({
  page,
}) => {
  const calls = await fixtures(page)
  await signIn(page)
  await page.reload()
  await expect(
    page
      .locator('header')
      .getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(calls.me).toBeGreaterThanOrEqual(2)
  const raw = await page.evaluate((k) => sessionStorage.getItem(k), key)
  expect(raw).not.toContain('password')
  expect(raw).not.toContain('role')
})

test('genuine activity extends the session; five inactive minutes sign out and clear storage', async ({
  page,
}) => {
  const calls = await fixtures(page)
  await page.clock.install()
  await signIn(page)
  await page.clock.fastForward(240000)
  await page.locator('header').getByRole('heading', {name:'Dashboard',exact:true}).click()
  await page.clock.fastForward(240000)
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.clock.fastForward(61000)
  await expect(page).toHaveURL(/\/login$/)
  await expect(
    page.getByText(
      'You were signed out after 5 minutes of inactivity. Please sign in again.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull()
  expect(calls.logout).toBe(1)
})

test('reloading an already-idle session does not reset its inactivity deadline', async ({
  page,
}) => {
  const calls = await fixtures(page)
  await signIn(page)
  const before = calls.me
  await page.addInitScript((k) => {
    const data = JSON.parse(sessionStorage.getItem(k))
    data.lastActivityAt = Date.now() - 300001
    sessionStorage.setItem(k, JSON.stringify(data))
  }, key)
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText(/signed out after 5 minutes/)).toBeVisible()
  expect(calls.me).toBe(before)
  expect(calls.refresh).toBe(0)
})

test('revoked sessions fail backend verification after reload', async ({
  page,
}) => {
  const calls = await fixtures(page)
  await signIn(page)
  calls.reject = true
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull()
})

test('access-token refresh rotates credentials without counting as user activity', async ({
  page,
}) => {
  const calls = await fixtures(page, { expiresIn: 60 })
  await page.clock.install()
  await signIn(page)
  const lastActivity = await page.evaluate(
    (k) => JSON.parse(sessionStorage.getItem(k)).lastActivityAt,
    key,
  )
  await page.clock.fastForward(31000)
  await expect.poll(() => calls.refresh).toBe(1)
  await expect
    .poll(async () =>
      page.evaluate(
        (k) => JSON.parse(sessionStorage.getItem(k))?.accessToken,
        key,
      ),
    )
    .toBe('renewed-access')
  const saved = await page.evaluate(
    (k) => JSON.parse(sessionStorage.getItem(k)),
    key,
  )
  expect(saved.refreshToken).toBe('renewed-refresh')
  expect(saved.lastActivityAt).toBe(lastActivity)
  await page.clock.fastForward(270000)
  await expect(page).toHaveURL(/\/login$/)
})
