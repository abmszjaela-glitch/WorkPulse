import { test, expect } from '@playwright/test'

test('empty data screens do not expose seeded records or stale preview identity', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'workpulse.profile.preview.v1',
      JSON.stringify({
        version: 1,
        firstName: 'Admin',
        lastName: 'User',
        phone: '+1 (555) 234-5678',
      }),
    )
    localStorage.setItem(
      'workpulse.settings.preview.v1',
      JSON.stringify({ rules: [{ name: 'Visual Studio Code' }] }),
    )
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const path of [
    '/dashboard',
    '/employees',
    '/departments',
    '/activity-details',
    '/application-usage',
    '/reports',
    '/settings',
    '/profile',
  ]) {
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('body')).not.toContainText(
      /Sarah Jenkins|Nimal Perera|Admin User|admin@workpulse.io|7h 42m|94 Active|NaN|undefined/,
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true)
  }
  expect(errors).toEqual([])
})

test('no-data reports cannot manufacture a generated report or export history', async ({
  page,
}) => {
  await page.goto('/reports')
  await page
    .getByRole('button', { name: 'Generate Report', exact: true })
    .click()
  await expect(
    page.getByText('No telemetry data is available to generate a report.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText('No report data loaded · Metrics remain unavailable.'),
  ).toBeVisible()
})
