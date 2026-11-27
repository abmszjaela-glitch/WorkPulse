import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyProfile,
  defaultProfile,
  validatePasswordChange,
  validateProfile,
} from '../../src/data/profile.js'

test('profile starts blank and validates personal information and passwords', () => {
  assert.equal(defaultProfile.firstName, '')
  assert.equal(defaultProfile.lastName, '')
  assert.equal(defaultProfile.phone, '')
  const profile = copyProfile()
  profile.firstName = 'Test'
  profile.lastName = 'Person'
  assert.equal(validateProfile(profile), null)
  assert.ok(
    validatePasswordChange('OldPassword1!', 'NewPassword2!', 'Mismatch'),
  )
  assert.ok(!Object.keys(defaultProfile).some((key) => /password/i.test(key)))
})
