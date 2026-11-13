import Button from '../components/ui/Button.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useRef, useState } from 'react'
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  LogOut,
  Monitor,
  Pencil,
  Save,
  ShieldCheck,
} from 'lucide-react'
import Sidebar from '../components/layout/Sidebar.jsx'
import useProfile from '../hooks/useProfile.js'
import {
  profileAccount as account,
  copyProfile,
  passwordRequirements,
  profileLanguages,
  profileTimezones,
  validatePasswordChange,
} from '../data/profile.js'

const panel = 'rounded-2xl border border-line/60 bg-white shadow-card'
const field =
  'mt-1.5 w-full rounded-lg border border-line/70 bg-white px-3 py-2.5 text-xs text-ink shadow-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-muted disabled:shadow-none'
const sections = [
  {
    id: 'personal',
    text: 'Personal Information name phone language time zone contact',
  },
  { id: 'summary', text: 'Account Summary role permissions login details' },
  { id: 'password', text: 'Change Password security requirements' },
  {
    id: 'notifications',
    text: 'Notification Preferences daily summary idle alert weekly report email',
  },
  { id: 'logins', text: 'Recent Login Activity device browser location' },
  { id: 'sessions', text: 'Session Security sign out devices' },
]
function PasswordField({ id, label, value, onChange, error }) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block text-[11px] font-medium text-muted-strong">
      {label}
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={
            id === 'current-password' ? 'current-password' : 'new-password'
          }
          className={`${field} !pr-10 ${error ? '!border-error bg-red-50/30' : ''}`}
          value={value}
          maxLength={128}
          onChange={onChange}
          aria-invalid={error}
          aria-describedby={error ? 'confirm-password-mismatch' : undefined}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          className="absolute right-3 top-4 text-muted"
          onClick={() => setVisible((previous) => !previous)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && (
        <span
          id="confirm-password-mismatch"
          className="mt-1 block text-[10px] text-error"
        >
          Passwords do not match.
        </span>
      )}
    </label>
  )
}

export default function ProfilePage() {
  const { profile, saveProfile, loadError } = useProfile()
  const [draft, setDraft] = useState(() => copyProfile(profile))
  const [notifications, setNotifications] = useState({
    ...profile.notifications,
  })
  const [notice, setNotice] = useState(loadError)
  const [profileError, setProfileError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwords, setPasswords] = useState({
    current: '',
    next: '',
    confirm: '',
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const firstName = useRef(null)
  const photoInput = useRef(null)
  const requirements = passwordRequirements(passwords.next)
  const strength = requirements.filter(Boolean).length
  const dirty = [
    'firstName',
    'lastName',
    'phone',
    'language',
    'timezone',
    'photo',
  ].some((key) => draft[key] !== profile[key])
  const notificationsDirty =
    JSON.stringify(notifications) !== JSON.stringify(profile.notifications)
  const show = (id) =>
    sections
      .find((section) => section.id === id)
      .text.toLowerCase()
      .includes(search.trim().toLowerCase())
  const update = (key, value) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setProfileError('')
  }
  const save = (event) => {
    event.preventDefault()
    const error = saveProfile({
      ...draft,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      phone: draft.phone.trim(),
      notifications: profile.notifications,
    })
    if (error) setProfileError(error)
    else {
      setDraft((previous) => ({
        ...previous,
        firstName: previous.firstName.trim(),
        lastName: previous.lastName.trim(),
        phone: previous.phone.trim(),
      }))
      setNotice(
        'Profile saved in this browser. No live account details have been changed.',
      )
    }
  }
  const selectPhoto = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 500 * 1024
    ) {
      setNotice('Choose a PNG, JPEG or WebP image up to 500 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      update('photo', reader.result)
      setNotice('Photo selected. Save Changes to keep it in this browser.')
    }
    reader.onerror = () => setNotice('The selected photo could not be read.')
    reader.readAsDataURL(file)
  }
  const changePassword = (event) => {
    event.preventDefault()
    const error = validatePasswordChange(
      passwords.current,
      passwords.next,
      passwords.confirm,
    )
    if (error) {
      setPasswordError(error)
      return
    }
    setPasswordError(
      'Password changes are unavailable until backend authentication is connected. No password has been changed or stored.',
    )
    setPasswords({ current: '', next: '', confirm: '' })
  }
  const cancelProfile = () => {
    setDraft(copyProfile(profile))
    setProfileError('')
    setNotice('Unsaved personal information changes discarded.')
  }
  return (
    <div className="dashboard-shell">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNotice={setNotice}
      />
      <div className="dashboard-workspace">
        <PageHeader
          title="My Profile"
          subtitle="Manage your account details and security"
          search={{
            label: 'Search profile sections',
            value: search,
            onChange: setSearch,
          }}
          onMenuOpen={() => setMenuOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="dashboard-content !pt-5"
        >
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          <section
            className={`${panel} flex flex-wrap items-center gap-6 p-6`}
            aria-label="Profile overview"
          >
            <div className="relative shrink-0">
              <span className="flex size-[74px] items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-2xl font-bold text-primary">
                {draft.photo ? (
                  <img
                    className="size-full object-cover"
                    src={draft.photo}
                    alt="Selected profile"
                  />
                ) : (
                  `${draft.firstName[0] || ''}${draft.lastName[0] || ''}`.toUpperCase()
                )}
              </span>
              <button
                className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-sm"
                aria-label="Choose profile photo"
                onClick={() => photoInput.current.click()}
              >
                <Camera size={14} />
              </button>
              <input
                ref={photoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Upload profile photo"
                onChange={selectPhoto}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-bold tracking-tight">
                  {profile.firstName} {profile.lastName}
                </h1>
                <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-green-800">
                  ● Preview account
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{account.email}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                  Administrator
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-muted-strong">
                  {account.department}
                </span>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted">
                <CalendarDays size={12} />
                Browser preview · Account creation date unavailable
              </p>
              {draft.photo && (
                <button
                  className="mt-2 text-[10px] text-error"
                  onClick={() => update('photo', '')}
                >
                  Remove photo
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="primary"
              className="sm:ml-auto"
              onClick={() => {
                setSearch('')
                setTimeout(() => {
                  firstName.current?.scrollIntoView({
                    block: 'center',
                    behavior: 'smooth',
                  })
                  firstName.current?.focus()
                }, 0)
              }}
            >
              <Pencil size={15} />
              Edit Profile
            </Button>
          </section>
          {!sections.some((section) => show(section.id)) && (
            <div className={`${panel} mt-6 p-10 text-center`}>
              <p className="text-sm text-muted">
                No matching profile sections.
              </p>
              <button
                className="mt-2 text-xs text-primary"
                onClick={() => setSearch('')}
              >
                Clear search
              </button>
            </div>
          )}
          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.42fr)_minmax(0,1fr)]">
            {show('personal') && (
              <section className={`${panel} overflow-hidden`}>
                <form onSubmit={save} noValidate>
                  <div className="p-6">
                    <h2 className="text-sm font-semibold">
                      Personal Information
                    </h2>
                    <p className="mt-1 text-[11px] text-muted">
                      Update your personal and contact details
                    </p>
                    <div className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                      <label className="block text-[11px] font-medium text-muted-strong">
                        First name
                        <input
                          ref={firstName}
                          className={field}
                          maxLength={50}
                          required
                          autoComplete="given-name"
                          value={draft.firstName}
                          onChange={(event) =>
                            update('firstName', event.target.value)
                          }
                        />
                      </label>
                      <label className="block text-[11px] font-medium text-muted-strong">
                        Last name
                        <input
                          className={field}
                          maxLength={50}
                          required
                          autoComplete="family-name"
                          value={draft.lastName}
                          onChange={(event) =>
                            update('lastName', event.target.value)
                          }
                        />
                      </label>
                      <label className="block text-[11px] font-medium text-muted-strong">
                        Email address
                        <div className="relative">
                          <input
                            className={`${field} !pr-8`}
                            value={account.email}
                            disabled
                          />
                          <LockKeyhole
                            size={14}
                            className="absolute right-3 top-4 text-muted"
                          />
                        </div>
                      </label>
                      <label className="block text-[11px] font-medium text-muted-strong">
                        Phone number
                        <input
                          className={field}
                          type="tel"
                          autoComplete="tel"
                          maxLength={40}
                          value={draft.phone}
                          onChange={(event) =>
                            update('phone', event.target.value)
                          }
                        />
                      </label>
                      {[
                        ['Employee ID', account.employeeId],
                        ['Department', account.department],
                      ].map(([title, value]) => (
                        <label
                          key={title}
                          className="block text-[11px] font-medium text-muted-strong"
                        >
                          {title}
                          <div className="relative">
                            <input
                              className={`${field} !pr-8`}
                              value={value}
                              disabled
                            />
                            <LockKeyhole
                              size={14}
                              className="absolute right-3 top-4 text-muted"
                            />
                          </div>
                        </label>
                      ))}
                      <label className="block text-[11px] font-medium text-muted-strong">
                        Preferred language
                        <select
                          className={field}
                          value={draft.language}
                          onChange={(event) =>
                            update('language', event.target.value)
                          }
                        >
                          {profileLanguages.map((language) => (
                            <option key={language}>{language}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-[11px] font-medium text-muted-strong">
                        Time zone
                        <select
                          className={field}
                          value={draft.timezone}
                          onChange={(event) =>
                            update('timezone', event.target.value)
                          }
                        >
                          {profileTimezones.map((timezone) => (
                            <option key={timezone}>{timezone}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="mt-4 text-[10px] leading-relaxed text-muted">
                      Language and time zone are saved preferences. Translations
                      and server timestamps are not changed by this preview.
                    </p>
                    {profileError && (
                      <p className="mt-3 text-xs text-error" role="alert">
                        {profileError}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 bg-soft px-6 py-4">
                    <Button
                      variant="secondary"
                      type="button"
                      className="disabled:opacity-40"
                      disabled={!dirty}
                      onClick={cancelProfile}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      type="submit"
                      className="disabled:opacity-40"
                      disabled={!dirty}
                    >
                      Save Changes
                    </Button>
                  </div>
                </form>
              </section>
            )}
            {show('summary') && (
              <section className={`${panel} p-6`}>
                <h2 className="text-sm font-semibold">Account Summary</h2>
                <p className="mt-1 text-[11px] text-muted">
                  System privileges and access credentials
                </p>
                <dl className="mt-5 space-y-2">
                  {[
                    ['Last Login Time', 'Backend not connected'],
                    ['Last Login Device & IP', 'Unavailable in preview'],
                    ['Account Created', 'Unavailable in preview'],
                    ['Assigned Role', `${account.role} · Preview`],
                  ].map(([title, value]) => (
                    <div
                      key={title}
                      className="flex items-center justify-between gap-4 rounded-lg bg-soft px-3 py-3"
                    >
                      <dt className="text-[10px] text-muted">{title}</dt>
                      <dd className="text-right text-xs font-medium">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 rounded-xl bg-slate-50 p-4">
                  <div className="flex justify-between gap-2 text-[10px]">
                    <h3 className="font-semibold tracking-wide text-muted">
                      ROLE CAPABILITIES
                    </h3>
                    <span className="text-primary">UI preview</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {[
                      'Review telemetry and activity reports',
                      'Manage departments and employees',
                      'Configure monitoring preferences',
                      'Export sample productivity reports',
                    ].map((text) => (
                      <li
                        key={text}
                        className="flex items-start gap-2 text-xs leading-relaxed text-ink"
                      >
                        <CheckCircle2
                          size={15}
                          className="mt-0.5 shrink-0 text-green-800"
                        />
                        {text}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[10px] leading-relaxed text-muted">
                    Backend authorization must enforce actual permissions. This
                    profile does not grant access rights.
                  </p>
                </div>
              </section>
            )}
          </div>
          {show('password') && (
            <section className={`${panel} mt-6 overflow-hidden`}>
              <form onSubmit={changePassword}>
                <div className="p-6">
                  <h2 className="text-sm font-semibold">Change Password</h2>
                  <p className="mt-1 text-[11px] text-muted">
                    Use a secure and unique password. Backend authentication is
                    not connected.
                  </p>
                  <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
                    <div>
                      <PasswordField
                        id="current-password"
                        label="Current password"
                        value={passwords.current}
                        onChange={(event) => {
                          setPasswords((previous) => ({
                            ...previous,
                            current: event.target.value,
                          }))
                          setPasswordError('')
                        }}
                      />
                      <p className="mt-2 text-[10px] text-muted">
                        Current password verification requires the backend.
                      </p>
                    </div>
                    <div>
                      <PasswordField
                        id="new-password"
                        label="New password"
                        value={passwords.next}
                        onChange={(event) => {
                          setPasswords((previous) => ({
                            ...previous,
                            next: event.target.value,
                          }))
                          setPasswordError('')
                        }}
                      />
                      <div className="mt-2 flex justify-between text-[10px] text-muted">
                        <span>Password strength</span>
                        <span>
                          {passwords.next
                            ? ['Weak', 'Weak', 'Fair', 'Medium', 'Strong'][
                                strength
                              ]
                            : 'Not entered'}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-4 gap-1">
                        {[0, 1, 2, 3].map((index) => (
                          <span
                            key={index}
                            className={`h-1.5 rounded-full ${index < strength ? (strength === 4 ? 'bg-success' : 'bg-indigo-500') : 'bg-slate-200'}`}
                          />
                        ))}
                      </div>
                    </div>
                    <PasswordField
                      id="confirm-password"
                      label="Confirm new password"
                      value={passwords.confirm}
                      error={Boolean(
                        passwords.confirm &&
                        passwords.confirm !== passwords.next,
                      )}
                      onChange={(event) => {
                        setPasswords((previous) => ({
                          ...previous,
                          confirm: event.target.value,
                        }))
                        setPasswordError('')
                      }}
                    />
                  </div>
                  {passwordError && (
                    <p
                      id="password-form-error"
                      className="mt-4 text-xs text-error"
                      role="alert"
                    >
                      {passwordError}
                    </p>
                  )}
                  <div className="mt-6 rounded-xl bg-soft p-4">
                    <h3 className="text-[10px] font-semibold tracking-wide text-muted">
                      SECURITY REQUIREMENTS
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        'At least 8 characters',
                        'One uppercase letter',
                        'One number',
                        'One special character',
                      ].map((text, index) => {
                        const Icon = requirements[index] ? CheckCircle2 : Circle
                        return (
                          <span
                            key={text}
                            className={`flex items-center gap-2 text-xs ${requirements[index] ? 'text-green-800' : 'text-muted'}`}
                          >
                            <Icon size={15} />
                            {text}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 bg-soft px-6 py-4">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      setPasswords({ current: '', next: '', confirm: '' })
                      setPasswordError('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit">
                    Update Password
                  </Button>
                </div>
              </form>
            </section>
          )}
          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.42fr)]">
            {show('notifications') && (
              <section className={`${panel} p-6`}>
                <h2 className="text-sm font-semibold">
                  Notification Preferences
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Control your preferred alerts and report deliveries
                </p>
                <div className="mt-3 space-y-2">
                  {[
                    [
                      'daily',
                      'Email me daily summary',
                      'Receive an executive productivity recap each morning.',
                    ],
                    [
                      'idle',
                      'Alert when an employee is idle for long',
                      'Request alerts for prolonged inactivity.',
                    ],
                    [
                      'weekly',
                      'Weekly report by email',
                      'Request a weekly productivity report.',
                    ],
                  ].map(([key, title, description]) => (
                    <div key={key} className="flex items-start gap-5 py-4">
                      <div className="flex-1">
                        <h3 className="text-xs font-medium text-ink">
                          {title}
                        </h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted">
                          {description}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label={title}
                        aria-checked={notifications[key]}
                        className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${notifications[key] ? 'bg-primary' : 'bg-slate-200'}`}
                        onClick={() =>
                          setNotifications((previous) => ({
                            ...previous,
                            [key]: !previous[key],
                          }))
                        }
                      >
                        <span
                          className={`block size-5 rounded-full bg-white shadow-sm transition-transform ${notifications[key] ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-muted">
                  Preferences are stored locally. No emails or live
                  notifications are sent.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  className="mt-4 disabled:opacity-40"
                  disabled={!notificationsDirty}
                  onClick={() => {
                    const error = saveProfile({ ...profile, notifications })
                    setNotice(
                      error ||
                        'Notification preferences saved in this browser only.',
                    )
                  }}
                >
                  <Save size={14} />
                  Save Preferences
                </Button>
              </section>
            )}
            {show('logins') && (
              <section className={`${panel} p-6`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">
                    Recent Login Activity
                  </h2>
                  <span className="rounded-full bg-soft px-2 py-1 text-[9px] text-muted">
                    Not connected
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Review authentication sessions across devices
                </p>
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-96 text-left text-[10px]">
                    <thead className="bg-slate-50 uppercase tracking-wide text-muted">
                      <tr>
                        {[
                          'Date & Time',
                          'Device & Browser',
                          'IP & Location',
                        ].map((title) => (
                          <th className="px-3 py-3 font-medium" key={title}>
                            {title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <Monitor size={26} className="text-muted" />
                    <p className="max-w-xs text-xs leading-relaxed text-muted">
                      No authentication sessions are available. Login history
                      will appear when backend authentication is connected.
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>
          {show('sessions') && (
            <section
              className={`${panel} mt-6 flex flex-wrap items-center gap-4 p-6`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-soft text-primary">
                <KeyRound size={22} />
              </span>
              <div className="max-w-xl flex-1">
                <h2 className="text-sm font-semibold">Session Security</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-strong">
                  Terminate other active sessions if you suspect unauthorized
                  access or used a shared computer. Session revocation requires
                  a connected authentication backend.
                </p>
              </div>
              <button
                className="flex items-center gap-2 rounded-lg bg-red-100 px-4 py-3 text-xs font-medium text-error hover:bg-red-200"
                onClick={() =>
                  setNotice(
                    'Signing out all devices is unavailable until backend authentication and session revocation are connected. No sessions were changed.',
                  )
                }
              >
                <LogOut size={16} />
                Sign out from all devices
              </button>
            </section>
          )}
          <p className="mt-5 flex items-center justify-center gap-1 text-[10px] text-muted">
            <ShieldCheck size={13} />
            Profile preview · Passwords are never saved to browser storage
          </p>
        </main>
      </div>
    </div>
  )
}
