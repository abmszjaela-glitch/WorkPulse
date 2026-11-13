export const PROFILE_KEY = 'workpulse.profile.preview.v1'
export const profileLanguages = ['English (United States)', 'English (United Kingdom)', 'Sinhala', 'Tamil']
export const profileTimezones = ['Asia/Colombo', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Singapore']
export const defaultProfile = { version: 1, firstName: 'Admin', lastName: 'User', phone: '+1 (555) 234-5678', language: 'English (United States)', timezone: 'Asia/Colombo', photo: '', notifications: { daily: true, idle: true, weekly: false } }
export const profileAccount = { email: 'admin@workpulse.io', employeeId: 'EMP-0001', department: 'IT & Operations', role: 'Admin' }
export const copyProfile = (profile = defaultProfile) => JSON.parse(JSON.stringify(profile))
export function validateProfile(profile) {
  if (!profile || profile.version !== 1) return 'Unsupported profile format.'
  if (typeof profile.firstName !== 'string' || !profile.firstName.trim() || profile.firstName.length > 50 || typeof profile.lastName !== 'string' || !profile.lastName.trim() || profile.lastName.length > 50) return 'Enter first and last names, each up to 50 characters.'
  if (typeof profile.phone !== 'string' || profile.phone.length > 40 || (profile.phone && !/^[+\d\s().-]{5,40}$/.test(profile.phone))) return 'Enter a valid phone number, or leave it blank.'
  if (!profileLanguages.includes(profile.language) || !profileTimezones.includes(profile.timezone)) return 'Select a supported language and time zone.'
  if (typeof profile.photo !== 'string' || profile.photo.length > 710000 || (profile.photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.photo))) return 'Choose a PNG, JPEG or WebP image up to 500 KB.'
  if (!profile.notifications || ['daily', 'idle', 'weekly'].some((key) => typeof profile.notifications[key] !== 'boolean')) return 'Invalid notification preferences.'
  return null
}
export function loadProfile(storage) {
  try {
    const raw = storage.getItem(PROFILE_KEY)
    if (!raw) return { profile: copyProfile(), error: '' }
    const profile = JSON.parse(raw)
    if (validateProfile(profile)) throw new Error('Invalid profile')
    return { profile: copyProfile(profile), error: '' }
  } catch { return { profile: copyProfile(), error: 'Saved preview profile could not be loaded. Default details are shown.' } }
}
export function passwordRequirements(password) {
  return [password.length >= 8, /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)]
}
export function validatePasswordChange(current, password, confirm) {
  if (!current) return 'Enter your current password.'
  if (!passwordRequirements(password).every(Boolean)) return 'The new password must meet all four requirements.'
  if (password === current) return 'Choose a new password different from your current password.'
  if (password !== confirm) return 'Passwords do not match.'
  return null
}
