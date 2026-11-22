import { useEffect, useState } from 'react'
import { ProfileContext } from './ProfileContext.js'
import { copyProfile, validateProfile } from '../data/profile.js'
import useAuth from '../hooks/useAuth.js'
import {
  getProfile,
  getPreferences,
  updateProfile,
  updatePreferences,
} from '../services/profile.js'
import {
  profileFromApi,
  preferencesFromApi,
  personalInformationPayload,
} from '../utils/profile.js'

const blankProfile = copyProfile()
const blankAccount = { email: '', employeeId: '', department: '', role: '' }
export default function ProfileProvider({ children }) {
  const { session } = useAuth(),
    token = session?.accessToken
  const [loaded, setLoaded] = useState({
    token: null,
    profile: null,
    account: null,
    error: '',
  })
  const [revision, setRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!token) return
    let active = true
    const controller = new AbortController()
    Promise.all([
      getProfile(token, controller.signal),
      getPreferences(token, controller.signal),
    ])
      .then(([row, prefs]) => {
        const data = profileFromApi(row, prefs)
        if (active) setLoaded({ token, ...data, error: '' })
      })
      .catch((error) => {
        if (active && error.name !== 'AbortError')
          setLoaded({
            token,
            profile: null,
            account: null,
            error: error.message,
          })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [token, revision])
  const current = loaded.token === token ? loaded : null
  const profile = current?.profile || blankProfile
  const account = current?.account || blankAccount
  async function saveProfile(next) {
    if (!current?.profile) return 'Load your profile before saving changes.'
    const error = validateProfile(next)
    if (error) return error
    if (saving) return 'A profile update is already in progress.'
    setSaving(true)
    try {
      const row = await updateProfile(token, personalInformationPayload(next))
      const data = profileFromApi(row, {
        emailDailySummary: profile.notifications.daily,
        idleAlerts: profile.notifications.idle,
        emailWeeklyReport: profile.notifications.weekly,
      })
      setLoaded((previous) =>
        previous.token === token ? { ...previous, ...data } : previous,
      )
      return null
    } catch (failure) {
      return failure.message
    } finally {
      setSaving(false)
    }
  }
  async function savePreferences(notifications) {
    if (!current?.profile) return 'Load your profile before saving preferences.'
    if (saving) return 'A profile update is already in progress.'
    setSaving(true)
    try {
      const result = await updatePreferences(token, notifications)
      setLoaded((previous) =>
        previous.token === token
          ? {
              ...previous,
              profile: {
                ...previous.profile,
                notifications: preferencesFromApi(result),
              },
            }
          : previous,
      )
      return null
    } catch (failure) {
      return failure.message
    } finally {
      setSaving(false)
    }
  }
  function reloadProfile() {
    setLoaded({ token: null, profile: null, account: null, error: '' })
    setRevision((value) => value + 1)
  }
  return (
    <ProfileContext.Provider
      value={{
        profile,
        account,
        saveProfile,
        savePreferences,
        saving,
        loading: !!token && !current,
        loaded: !!current?.profile,
        loadError: current?.error || '',
        reloadProfile,
      }}
    >
      {children}
    </ProfileContext.Provider>
  )
}
