import { useState } from 'react'
import { ProfileContext } from './ProfileContext.js'
import { copyProfile, loadProfile, PROFILE_KEY, validateProfile } from '../data/profile.js'

export default function ProfileProvider({ children }) {
  const [initial] = useState(() => {
    try { return loadProfile(window.localStorage) }
    catch { return { profile: copyProfile(), error: 'Browser storage is unavailable. Profile changes may not be saved.' } }
  })
  const [profile, setProfile] = useState(initial.profile)
  const saveProfile = (next) => {
    const error = validateProfile(next)
    if (error) return error
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
      setProfile(copyProfile(next))
      return null
    } catch { return 'Profile could not be saved. Browser storage may be unavailable or full.' }
  }
  return <ProfileContext.Provider value={{ profile, saveProfile, loadError: initial.error }}>{children}</ProfileContext.Provider>
}
