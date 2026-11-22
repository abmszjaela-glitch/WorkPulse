export const PROFILE_KEY = 'workpulse.profile.draft.v2'
export const profileLanguages = [
  'English (United States)',
  'English (United Kingdom)',
  'Sinhala',
  'Tamil',
]
export const profileTimezones = [
  'Asia/Colombo',
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Singapore',
]
export const defaultProfile = {
  version: 1,
  firstName: '',
  lastName: '',
  phone: '',
  language: 'English (United States)',
  timezone: 'Asia/Colombo',
  photo: '',
  notifications: { daily: false, idle: false, weekly: false },
}
export const profileAccount = {
  email: '',
  employeeId: '',
  department: '',
  role: '',
}
export const copyProfile = (profile = defaultProfile) =>
  JSON.parse(JSON.stringify(profile))
export function validateProfile(profile) {
  if (!profile || profile.version !== 1) return 'Unsupported profile format.'
  if (
    typeof profile.firstName !== 'string' ||
    !profile.firstName.trim() ||
    profile.firstName.length > 100 ||
    typeof profile.lastName !== 'string' ||
    !profile.lastName.trim() ||
    profile.lastName.length > 100
  )
    return 'Enter first and last names, each up to 100 characters.'
  if (
    typeof profile.phone !== 'string' ||
    profile.phone.length > 32 ||
    (profile.phone && !/^[+\d\s().-]{5,32}$/.test(profile.phone))
  )
    return 'Enter a valid phone number, or leave it blank.'
  if (
    typeof profile.language !== 'string' ||
    !profile.language.trim() ||
    profile.language.length > 35 ||
    typeof profile.timezone !== 'string'
  )
    return 'Select a supported language and time zone.'
  try {
    new Intl.DateTimeFormat('en', { timeZone: profile.timezone })
  } catch {
    return 'Select a valid time zone.'
  }
  if (
    typeof profile.photo !== 'string' ||
    profile.photo.length > 710000 ||
    (profile.photo &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        profile.photo,
      ))
  )
    return 'Choose a PNG, JPEG or WebP image up to 500 KB.'
  if (
    !profile.notifications ||
    ['daily', 'idle', 'weekly'].some(
      (key) => typeof profile.notifications[key] !== 'boolean',
    )
  )
    return 'Invalid notification preferences.'
  return null
}
export function loadProfile(storage) {
  try {
    const raw = storage.getItem(PROFILE_KEY)
    if (!raw) return { profile: copyProfile(), error: '' }
    const profile = JSON.parse(raw)
    if (validateProfile(profile)) throw new Error('Invalid profile')
    return { profile: copyProfile(profile), error: '' }
  } catch {
    return {
      profile: copyProfile(),
      error:
        'Saved preview profile could not be loaded. Default details are shown.',
    }
  }
}
export function passwordRequirements(password) {
  return [
    password.length >= 8,
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
}
export function validatePasswordChange(current, password, confirm) {
  if (!current) return 'Enter your current password.'
  if (!passwordRequirements(password).every(Boolean))
    return 'The new password must meet all four requirements.'
  if (password === current)
    return 'Choose a new password different from your current password.'
  if (password !== confirm) return 'Passwords do not match.'
  return null
}
