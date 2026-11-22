import { test, expect } from '@playwright/test'

test('employee create/list/edit/status use authenticated APIs and survive reload without fake success', async ({
  page,
}) => {
  // In-memory HTTP fixtures test the UI contract only; backend tests use real
  // isolated PostgreSQL transactions for password hashing and persistence.
  const rows = [],
    departmentId = '11111111-1111-4111-8111-111111111111'
  let received,
    createCalls = 0,
    releaseCreate
  const gate = new Promise((resolve) => {
    releaseCreate = resolve
  })
  await page.route('https://fonts.googleapis.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
  await page.route('**/api/v1/auth/login', (r) =>
    r.fulfill({
      json: {
        accessToken: 'fixture-admin-access',
        refreshToken: 'fixture-refresh',
        expiresIn: 900,
      },
    }),
  )
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      json: {
        user: { id: 'admin-fixture', role: 'A', mustChangePassword: false },
      },
    }),
  )
  await page.route('**/api/v1/profile', (r) =>
    r.fulfill({
      json: {
        id: 'admin-fixture',
        first_name: 'Test',
        last_name: 'Admin',
        role: 'A',
        language: 'en',
        timezone: 'UTC',
      },
    }),
  )
  await page.route('**/api/v1/profile/notification-preferences', (r) =>
    r.fulfill({ json: {} }),
  )
  await page.route('**/api/v1/departments?*', (r) =>
    r.fulfill({
      json: {
        items: [{ id: departmentId, name: 'Test department', is_active: true }],
        total: 1,
        page: 1,
        pageSize: 100,
      },
    }),
  )
  await page.route('**/api/v1/employees**', async (r) => {
    expect(r.request().headers().authorization).toBe(
      'Bearer fixture-admin-access',
    )
    const url = new URL(r.request().url()),
      path = url.pathname,
      method = r.request().method()
    if (path.endsWith('/summary'))
      return r.fulfill({
        json: {
          totalEmployees: rows.length,
          activeAccounts: rows.filter((x) => x.is_active).length,
          deactivated: rows.filter((x) => !x.is_active).length,
          agentNotInstalled: rows.length,
        },
      })
    if (path.endsWith('/bulk-deactivate')) {
      const ids = r.request().postDataJSON().ids
      rows.forEach((row) => {
        if (ids.includes(row.id)) row.is_active = false
      })
      return r.fulfill({ json: { updated: ids.length } })
    }
    if (path.endsWith('/status')) {
      rows[0].is_active = r.request().postDataJSON().active
      return r.fulfill({ json: rows[0] })
    }
    if (method === 'POST') {
      createCalls++
      received = r.request().postDataJSON()
      if (
        rows.some(
          (row) =>
            row.employee_code === received.employeeCode ||
            row.email === received.email,
        )
      )
        return r.fulfill({
          status: 409,
          json: { error: { message: 'Duplicate record' } },
        })
      await gate
      rows.push({
        id: '22222222-2222-4222-8222-222222222222',
        employee_code: received.employeeCode,
        first_name: received.firstName,
        last_name: received.lastName,
        email: received.email,
        phone: received.phone,
        role: received.role,
        department_id: received.departmentId,
        department_name: 'Test department',
        is_active: true,
        agent_installed: false,
        last_seen: null,
      })
      return r.fulfill({ status: 201, json: rows[0] })
    }
    if (method === 'PUT') {
      const body = r.request().postDataJSON()
      expect(Object.keys(body)).toEqual(['firstName'])
      rows[0].first_name = body.firstName
      return r.fulfill({ json: rows[0] })
    }
    let filtered = rows
    const search = url.searchParams.get('search')?.toLowerCase()
    if (search)
      filtered = filtered.filter((row) =>
        (
          row.first_name +
          ' ' +
          row.last_name +
          ' ' +
          row.employee_code +
          ' ' +
          row.email
        )
          .toLowerCase()
          .includes(search),
      )
    const pageNumber = Number(url.searchParams.get('page') || 1),
      size = Number(url.searchParams.get('pageSize') || 8)
    return r.fulfill({
      json: {
        items: filtered.slice((pageNumber - 1) * size, pageNumber * size),
        total: filtered.length,
        page: pageNumber,
        pageSize: size,
      },
    })
  })
  try {
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
    const menu = page.getByRole('button', {
      name: 'Open navigation',
      exact: true,
    })
    if (await menu.isVisible()) await menu.click()
    await page
      .getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('link', { name: 'Employees', exact: true })
      .click()
    const add = page.getByRole('button', { name: 'Add Employee', exact: true })
    await expect(add).toBeEnabled()
    await add.click()
    const dialog = page.getByRole('dialog')
    async function fill(email = 'created@example.test') {
      await dialog.getByLabel('First name', { exact: true }).fill('Created')
      await dialog
        .getByLabel('Last name', { exact: true })
        .fill('Employee Family')
      await dialog.getByLabel('Email address', { exact: true }).fill(email)
      await dialog.getByLabel('Employee ID', { exact: true }).fill('TEST-CODE')
      await dialog
        .getByLabel('Phone number', { exact: true })
        .fill('+94112345678')
      await dialog
        .getByLabel('Department', { exact: true })
        .selectOption(departmentId)
      await dialog
        .getByLabel('Temporary Password', { exact: true })
        .fill('Employee-password-123!')
    }
    await fill()
    await dialog
      .getByRole('button', { name: 'Save Employee', exact: true })
      .click()
    await expect.poll(() => createCalls).toBe(1)
    await expect(
      dialog.getByRole('button', { name: 'Saving…', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByText(
        'Employee created in the database. Showing the saved employee.',
        { exact: true },
      ),
    ).toHaveCount(0)
    expect(received).toMatchObject({
      firstName: 'Created',
      lastName: 'Employee Family',
      employeeCode: 'TEST-CODE',
      departmentId,
      role: 'E',
      password: 'Employee-password-123!',
      temporary: true,
    })
    expect(received).not.toHaveProperty('id')
    expect(received).not.toHaveProperty('manager')
    releaseCreate()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'TEST-CODE', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
    ).not.toContain('Employee-password-123!')
    await page.reload()
    await expect(
      page.getByRole('cell', { name: 'TEST-CODE', exact: true }),
    ).toBeVisible()
    await expect(add).toBeEnabled()
    await add.click()
    await fill('duplicate@example.test')
    await dialog
      .getByRole('button', { name: 'Save Employee', exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toContainText(
      'email or employee ID may already exist',
    )
    await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue(
      'Created',
    )
    expect(rows).toHaveLength(1)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('button', {
        name: 'Edit Created Employee Family',
        exact: true,
      })
      .click()
    await dialog.getByLabel('First name', { exact: true }).fill('Updated')
    await dialog
      .getByRole('button', { name: 'Save Employee', exact: true })
      .click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('button', {
        name: 'Deactivate Updated Employee Family',
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: 'Deactivate Updated Employee Family',
        exact: true,
      })
      .click()
    await dialog
      .getByRole('button', { name: 'Deactivate', exact: true })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'Activate Updated Employee Family',
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: 'Activate Updated Employee Family',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'Deactivate Updated Employee Family',
        exact: true,
      }),
    ).toBeVisible()
  } finally {
    releaseCreate()
  }
})
