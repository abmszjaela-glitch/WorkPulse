import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_SESSION_KEY,
  ADMIN_IDLE_MS,
  isIdle,
  readSession,
  writeSession,
} from '../../src/utils/admin-session.js'

const now = 1_000_000
const session = {
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
  expiresAt: now + 900000,
  lastActivityAt: now,
  user: { role: 'A' },
  password: 'must-not-persist',
}
function storage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
test('session storage retains refresh metadata without storing passwords or trusting a cached role', () => {
  const store = storage()
  writeSession(store, session)
  const raw = store.getItem(ADMIN_SESSION_KEY)
  assert.ok(!raw.includes('password'))
  assert.ok(!raw.includes('role'))
  const restored = readSession(store, now + 1000).session
  assert.equal(restored.lastActivityAt, now)
  assert.equal(restored.user, undefined)
})
test('five-minute inactivity boundary is exact and recent activity extends it', () => {
  assert.equal(isIdle(now, now + ADMIN_IDLE_MS - 1), false)
  assert.equal(isIdle(now, now + ADMIN_IDLE_MS), true)
  assert.equal(isIdle(now + 240000, now + ADMIN_IDLE_MS), false)
  assert.equal(isIdle(now + 1, now), true)
})
test('reload never resets last activity and cannot restore an idle session', () => {
  const store = storage()
  writeSession(store, session)
  assert.equal(readSession(store, now + 240000).session.lastActivityAt, now)
  const expired = readSession(store, now + ADMIN_IDLE_MS)
  assert.equal(expired.session, null)
  assert.equal(expired.reason, 'idle')
  assert.equal(store.getItem(ADMIN_SESSION_KEY), null)
})
test('recently active expired access tokens can be restored through backend refresh', () => {
  const store = storage()
  writeSession(store, { ...session, expiresAt: now - 1 })
  assert.equal(
    readSession(store, now + 1000).session.refreshToken,
    'test-refresh',
  )
})
test('corrupt and incomplete cached credentials fail closed', () => {
  const store = storage()
  for (const raw of ['broken', '{}', JSON.stringify({ user: { role: 'A' } })]) {
    store.setItem(ADMIN_SESSION_KEY, raw)
    assert.equal(readSession(store, now).session, null)
    assert.equal(store.getItem(ADMIN_SESSION_KEY), null)
  }
})
