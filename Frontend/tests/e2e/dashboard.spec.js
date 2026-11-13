import { test, expect } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  // Make UI verification independent of the external font service.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
})

const routes = [
  ['/dashboard', 'Dashboard'],
  ['/employees', 'Employees'],
  ['/activity-details', 'Activity Details'],
  ['/application-usage', 'Application Usage'],
  ['/departments', 'Departments'],
  ['/reports', 'Reports & Analytics'],
  ['/settings', 'System Settings'],
  ['/profile', 'My Profile'],
  ['/login', null],
]
async function openNavigation(page) {
  const button = page.getByRole('button', {
    name: 'Open navigation',
    exact: true,
  })
  if (await button.isVisible()) await button.click()
}
for (const [route, title] of routes) {
  test(`route ${route} loads without runtime errors or page overflow`, async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (
        message.type() === 'warning' &&
        /width|height|React|key prop/i.test(message.text())
      )
        errors.push(message.text())
    })
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    if (title)
      await expect(
        page
          .locator('header')
          .getByRole('heading', { name: title, exact: true }),
      ).toBeVisible()
    else
      await expect(
        page.getByRole('heading', { name: 'Welcome back' }),
      ).toBeVisible()
    await page.waitForTimeout(250)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  })
}

test('all sidebar links, profile, browser back/forward and notification link', async ({
  page,
}) => {
  await page.goto('/dashboard')
  for (const [route, title] of routes.filter(
    ([path]) => !['/login', '/profile'].includes(path),
  )) {
    await openNavigation(page)
    const name = title === 'System Settings' ? 'Settings' : title
    const link = page
      .getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('link', { name, exact: true })
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${route}$`))
    await expect(link).toHaveAttribute('aria-current', 'page')
  }
  await page
    .locator('header')
    .getByRole('link', { name: 'Open my profile' })
    .click()
  await expect(page).toHaveURL(/\/profile$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/settings$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/profile$/)
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page
    .getByRole('link', { name: 'Manage notification preferences' })
    .click()
  await expect(page).toHaveURL(/\/settings#settings-notifications$/)
  await expect(page.locator('#settings-notifications')).toBeInViewport()
})

test('mobile navigation closes with Escape and returns focus', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile')
  await page.goto('/dashboard')
  const trigger = page.getByRole('button', { name: 'Open navigation' })
  await trigger.click()
  await expect(
    page.getByRole('dialog', { name: 'Main navigation panel' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.locator('#main-sidebar')).toHaveAttribute('inert', '')
})

test('employees add, duplicate validation, edit, deactivate, filters and CSV', async ({
  page,
}) => {
  await page.goto('/employees')
  await page.getByRole('button', { name: 'Add Employee', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('First name', { exact: true }).fill('Test')
  await dialog.getByLabel('Last name', { exact: true }).fill('Person')
  await dialog
    .getByLabel('Email address', { exact: true })
    .fill('sarah.j@workpulse.io')
  await dialog.getByLabel('Employee ID', { exact: true }).fill('WP-1999')
  await dialog.getByRole('button', { name: 'Save Employee' }).click()
  await expect(dialog.getByText('Email already exists.')).toBeVisible()
  await dialog
    .getByLabel('Email address', { exact: true })
    .fill('test.person@example.com')
  await dialog.getByRole('button', { name: 'Save Employee' }).click()
  await expect(dialog).toHaveCount(0)
  await page
    .getByRole('searchbox', { name: 'Search all employees', exact: true })
    .fill('Test Person')
  await expect(
    page.getByRole('table').getByText('Test Person', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Edit Test Person', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('First name', { exact: true }).fill('Updated')
  await dialog.getByRole('button', { name: 'Save Employee' }).click()
  await page
    .getByRole('searchbox', { name: 'Search all employees', exact: true })
    .fill('Updated Person')
  await page
    .getByRole('button', { name: 'Deactivate Updated Person', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deactivate', exact: true })
    .click()
  await expect(
    page.getByRole('table').getByText('Deactivated', { exact: true }),
  ).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/employees.*\.csv$/)
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page.getByRole('table').getByText('Sarah Jenkins')).toBeVisible()
})

test('department modal validation, schedule, deletion reassignment and view modes', async ({
  page,
}) => {
  await page.goto('/departments')
  await page
    .getByRole('button', { name: 'Add Department', exact: true })
    .click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Save Department' }).click()
  await expect(dialog.getByText('Department name is required.')).toBeVisible()
  await dialog.getByLabel('Department Name').fill('Quality Team')
  await dialog.getByRole('button', { name: 'Save Department' }).click()
  await expect(dialog).toHaveCount(0)
  await page
    .getByRole('searchbox', { name: 'Search departments or managers' })
    .fill('Quality Team')
  await page
    .getByRole('button', { name: 'Edit Quality Team', exact: true })
    .click()
  await page.getByRole('dialog').getByLabel('Shift end time').fill('18:00')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save Department' })
    .click()
  await page
    .getByRole('button', { name: 'Delete Quality Team', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete Department', exact: true })
    .click()
  await expect(page.getByText('No departments found')).toBeVisible()
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '+ Add new department' }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Delete Customer Support', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('button', { name: 'Delete Department', exact: true }),
  ).toBeDisabled()
  await dialog.getByLabel('Reassign employees to').selectOption('engineering')
  await dialog
    .getByRole('button', { name: 'Delete Department', exact: true })
    .click()
  await expect(
    page.getByRole('table').getByText('Customer Support', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: 'Engineering' })
      .getByText('60', { exact: true }),
  ).toBeVisible()
})

test('application usage scope, category changes, pagination, trend and download', async ({
  page,
}) => {
  await page.goto('/application-usage')
  await page
    .getByRole('combobox', { name: 'Department', exact: true })
    .selectOption('Engineering')
  await page
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption('WP-1001')
  await page
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption('Neutral')
  const row = page.getByRole('row').filter({ hasText: 'Google Chrome' })
  await row.getByRole('button', { name: 'Change', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Classification for Google Chrome' })
    .selectOption('Productive')
  await expect(page.getByRole('table').getByText('Google Chrome')).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Applications per page' })
    .selectOption('5')
  await page
    .getByRole('navigation', { name: 'Application pages' })
    .getByRole('button', { name: 'Next', exact: true })
    .click()
  await expect(
    page.getByRole('table').getByText('Facebook', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Usage trend period' })
    .selectOption('14')
  await page.getByRole('button', { name: 'Category Management Rules' }).click()
  await expect(
    page.getByText('Use Change to update a sample classification.', {
      exact: false,
    }),
  ).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(
    /application-usage.*csv$/,
  )
})

test('reports apply pending filters, switch groupings, export and archives', async ({
  page,
}) => {
  await page.goto('/reports')
  await page
    .getByRole('combobox', { name: 'Report department' })
    .selectOption('Engineering')
  await expect(
    page.getByText('Filters changed.', { exact: false }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Generate Report', exact: true })
    .click()
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: 'Department', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Detailed Department Telemetry' }),
  ).toBeVisible()
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/department-report/)
  await expect(
    page.getByRole('button', { name: 'Download', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Below 75%', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('settings save, restore, discard and category rule changes', async ({
  page,
}) => {
  await page.goto('/settings')
  await page
    .getByRole('switch', { name: 'Track application usage', exact: true })
    .click()
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await page.reload()
  await expect(
    page.getByRole('switch', { name: 'Track application usage', exact: true }),
  ).toHaveAttribute('aria-checked', 'false')
  await page
    .getByRole('switch', { name: 'Track application usage', exact: true })
    .click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(
    page.getByRole('switch', { name: 'Track application usage', exact: true }),
  ).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Application name', { exact: true }).fill('Test App')
  await page
    .locator('form')
    .getByRole('button', { name: 'Add rule', exact: true })
    .click()
  await expect(page.getByRole('table').getByText('Test App')).toBeVisible()
  await page
    .getByRole('button', { name: 'Delete Test App rule for All Departments' })
    .click()
  await expect(page.getByRole('table').getByText('Test App')).toHaveCount(0)
})

test('profile saves and restores details, password validation and notifications', async ({
  page,
}) => {
  await page.goto('/profile')
  await page.getByLabel('First name', { exact: true }).fill('Review')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('heading', { name: 'Review User' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Review',
  )
  await page
    .getByLabel('Current password', { exact: true })
    .fill('OldPassword1!')
  await page.getByLabel('New password', { exact: true }).fill('NewPassword2!')
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('Mismatch1!')
  await page.getByRole('button', { name: 'Update Password' }).click()
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.')
  await page.getByRole('switch', { name: 'Weekly report by email' }).click()
  await page.getByRole('button', { name: 'Save Preferences' }).click()
  await page.reload()
  await expect(
    page.getByRole('switch', { name: 'Weekly report by email' }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('login validates credentials without faking authentication and unknown routes have a recovery link', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.')
  await page
    .getByLabel('Email address', { exact: true })
    .fill('preview@example.com')
  await page.getByLabel('Password', { exact: true }).fill('PreviewPassword1!')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'text',
  )
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not available')
  await page.goto('/unknown-address')
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Return to dashboard' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('dashboard search, status and activity period controls', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await page
    .getByRole('searchbox', { name: 'Search employees', exact: true })
    .fill('Sarah')
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1)
  await page
    .getByRole('combobox', { name: 'Filter by status' })
    .selectOption('Idle')
  await expect(
    page.getByText('No employees match your search or status filter.'),
  ).toBeVisible()
  await page
    .getByRole('searchbox', { name: 'Search employees', exact: true })
    .fill('')
  await page
    .getByRole('combobox', { name: 'Filter by status' })
    .selectOption('All')
  await page
    .getByRole('combobox', { name: 'Activity period' })
    .selectOption('Last week')
  await expect(
    page.getByRole('img', { name: 'Active versus idle hours for last week' }),
  ).toBeVisible()
})

test('activity timeline, filters, pagination, CSV and print all matching rows', async ({
  page,
}) => {
  await page.goto('/activity-details')
  const interval = page.getByRole('button', { name: /^11 AM: active/ })
  await interval.click()
  await expect(interval).toHaveAttribute('aria-pressed', 'true')
  await page
    .getByRole('combobox', { name: 'Weekly activity period' })
    .selectOption('Last week')
  await page
    .getByRole('textbox', { name: 'Filter activity logs' })
    .fill('Slack')
  await page
    .getByRole('combobox', { name: 'Filter log status' })
    .selectOption('Active')
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(5)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/activity-preview.csv$/)
  await page.getByRole('textbox', { name: 'Filter activity logs' }).fill('')
  await page
    .getByRole('combobox', { name: 'Filter log status' })
    .selectOption('')
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(8)
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(36)
  await page.emulateMedia({ media: 'screen' })
})

test('modal Escape and backdrop restore keyboard focus', async ({ page }) => {
  await page.goto('/employees')
  const trigger = page.getByRole('button', {
    name: 'Add Employee',
    exact: true,
  })
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.mouse.click(2, 2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('settings anchors, copying working hours, privacy editing and invalid values', async ({
  page,
}) => {
  await page.goto('/settings')
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Working Hours', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Monday shift end' }).fill('18:00')
  await page
    .getByRole('button', { name: 'Copy Monday to all weekdays' })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Friday shift end' }),
  ).toHaveValue('18:00')
  await page.getByRole('button', { name: 'Edit Privacy Policy' }).click()
  await page
    .getByRole('textbox', { name: 'Policy draft' })
    .fill('Transparent monitoring policy for this browser preview.')
  await page
    .getByRole('spinbutton', { name: 'Offline storage limit in days' })
    .fill('40')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Offline storage must be between' }),
  ).toBeVisible()
  await page
    .getByRole('spinbutton', { name: 'Offline storage limit in days' })
    .fill('7')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Edit Privacy Policy' }).click()
  await expect(page.getByRole('textbox', { name: 'Policy draft' })).toHaveValue(
    'Transparent monitoring policy for this browser preview.',
  )
})

test('storage errors preserve unsaved profile edits', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage denied for verification')
    }
  })
  await page.goto('/profile')
  await page.getByLabel('First name', { exact: true }).fill('Unsaved')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Unsaved',
  )
  await page
    .getByRole('button', { name: 'Cancel', exact: true })
    .first()
    .click()
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Admin',
  )
})
