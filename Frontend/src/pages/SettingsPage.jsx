import MonitoringRules from '../components/settings/MonitoringRules.jsx'
import Toggle from '../components/ui/Toggle.jsx'
import ToggleRow from '../components/settings/ToggleRow.jsx'
import Button from '../components/ui/Button.jsx'
import Heading from '../components/ui/SectionHeading.jsx'
import Notice from '../components/ui/Notice.jsx'
import PageHeader from '../components/layout/PageHeader.jsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  FileText,
  Grid2X2,
  Info,
  LockKeyhole,
  Plus,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  Trash2,
  UsersRound,
} from 'lucide-react'
import Sidebar from '../components/layout/Sidebar.jsx'
import {
  cloneSettings,
  loadSettings,
  SETTINGS_KEY,
  shiftHours,
  validateSettings,
} from '../data/settings.js'
import { employeeDepartments, employeeRoles } from '../data/employees.js'

const panel =
  'scroll-mt-6 rounded-2xl border border-line/60 bg-white p-5 shadow-card sm:p-6'
const control =
  'rounded-lg border border-line/60 bg-white px-3 py-2.5 text-xs text-ink outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400'
const sections = [
  {
    id: 'monitoring',
    label: 'Monitoring Rules',
    Icon: SlidersHorizontal,
    words:
      'idle threshold timeout frequency sync batch application keyboard mouse tracking offline storage',
  },
  {
    id: 'hours',
    label: 'Working Hours',
    Icon: Clock3,
    words:
      'schedule shift monday tuesday wednesday thursday friday saturday sunday',
  },
  {
    id: 'categories',
    label: 'Application Categories',
    Icon: Grid2X2,
    words: 'rules productive neutral unproductive software urls classification',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    Icon: Bell,
    words: 'alerts idle offline digest email',
  },
  {
    id: 'privacy',
    label: 'Data & Privacy',
    Icon: Shield,
    words: 'retention consent transparency documentation policy',
  },
  {
    id: 'security',
    label: 'Security',
    Icon: LockKeyhole,
    words: 'session timeout multifactor mfa authentication',
  },
  {
    id: 'roles',
    label: 'User Roles',
    Icon: UsersRound,
    words: 'admin manager employee permissions access authorization',
  },
]
export default function SettingsPage() {
  const [initial] = useState(() => {
    try {
      return loadSettings(window.localStorage)
    } catch {
      return {
        settings: cloneSettings(),
        notice:
          'Browser storage is unavailable. Settings can be edited, but may not be saved.',
      }
    }
  })
  const [saved, setSaved] = useState(initial.settings)
  const [draft, setDraft] = useState(() => cloneSettings(initial.settings))
  const [notice, setNotice] = useState(initial.notice)
  const [search, setSearch] = useState('')
  const [activeSection, setActiveSection] = useState('monitoring')
  const [menuOpen, setMenuOpen] = useState(false)
  const [addingRule, setAddingRule] = useState(false)
  const [ruleError, setRuleError] = useState('')
  const [policyEditing, setPolicyEditing] = useState(false)
  const [lastSaved, setLastSaved] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const term = search.trim().toLowerCase()
  const visibleSections = sections.filter((section) =>
    `${section.label} ${section.words}`.toLowerCase().includes(term),
  )
  const show = (id) => visibleSections.some((section) => section.id === id)
  const update = (key, value) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setLastSaved(false)
  }
  useEffect(() => {
    if (!dirty) return
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const save = () => {
    const error = validateSettings(draft)
    if (error) {
      setNotice(error)
      return
    }
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(draft))
      setSaved(cloneSettings(draft))
      setLastSaved(true)
      setNotice(
        'Settings saved in this browser only. No agents, live policies or account permissions have been changed.',
      )
    } catch {
      setNotice(
        'Settings could not be saved. Browser storage may be unavailable or full. Your unsaved changes are still here.',
      )
    }
  }
  const discard = () => {
    setDraft(cloneSettings(saved))
    setAddingRule(false)
    setRuleError('')
    setLastSaved(false)
    setNotice('Unsaved changes discarded.')
  }
  const updateDay = (index, change) =>
    update(
      'schedule',
      draft.schedule.map((day, dayIndex) =>
        dayIndex === index ? { ...day, ...change } : day,
      ),
    )
  const addRule = (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const rule = {
      id: crypto.randomUUID(),
      name: values.name.trim(),
      category: values.category,
      scope: values.scope,
    }
    const next = { ...draft, rules: [...draft.rules, rule] }
    const error = validateSettings(next)
    if (error) {
      setRuleError(error)
      return
    }
    update('rules', next.rules)
    setAddingRule(false)
    setRuleError('')
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
          title="System Settings"
          subtitle="Monitoring preferences, schedules and privacy policies"
          search={{
            label: 'Search settings sections',
            value: search,
            onChange: setSearch,
          }}
          onMenuOpen={() => setMenuOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="dashboard-content !pb-8"
        >
          <nav className="em-breadcrumb" aria-label="Breadcrumb">
            <Link to="/dashboard">Dashboard</Link>
            <ChevronRight size={12} />
            <span aria-current="page">Settings</span>
          </nav>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                System Settings
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-muted-strong">
                Configure monitoring preferences, working schedules and privacy
                policies.
              </p>
            </div>
            <span className="flex items-center gap-2 rounded-lg border border-line/50 bg-white px-3 py-1.5 text-[10px] text-muted-strong">
              <i className="size-1.5 rounded-full bg-warning" />
              Browser preview · No central policy sync
            </span>
          </div>
          <Notice onDismiss={() => setNotice('')}>{notice}</Notice>
          <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-line/60 bg-white p-2 shadow-card xl:sticky xl:top-6">
              <h2 className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Configuration Hub
              </h2>
              <nav
                aria-label="Settings sections"
                className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-1"
              >
                {visibleSections.map(({ id, label, Icon }) => (
                  <a
                    key={id}
                    href={`#settings-${id}`}
                    onClick={() => setActiveSection(id)}
                    aria-current={activeSection === id ? 'location' : undefined}
                    className={`flex items-center gap-2 rounded-lg px-2 py-3 text-xs transition-colors ${activeSection === id ? 'bg-soft font-medium text-primary' : 'text-ink hover:bg-slate-50'}`}
                  >
                    <Icon size={16} className="shrink-0" />
                    {label}
                    {activeSection === id && (
                      <i className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </a>
                ))}
              </nav>
              <div className="mt-6 rounded-xl bg-soft p-3">
                <div className="flex items-center justify-between text-[10px]">
                  <strong className="font-semibold text-muted-strong">
                    DESKTOP AGENT
                  </strong>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-muted-strong">
                    Not connected
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-ink">
                  Preview configuration only
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  No telemetry nodes connected
                </p>
              </div>
            </aside>
            <div className="min-w-0 space-y-6">
              {!visibleSections.length && (
                <div className={`${panel} py-12 text-center`}>
                  <Search size={26} className="mx-auto text-muted" />
                  <h2 className="mt-3 font-semibold">No matching settings</h2>
                  <button
                    className="mt-2 text-xs text-primary"
                    onClick={() => setSearch('')}
                  >
                    Clear search
                  </button>
                </div>
              )}
              {show('monitoring') && (
                <MonitoringRules draft={draft} update={update} />
              )}
              {show('hours') && (
                <section id="settings-hours" className={panel}>
                  <Heading
                    title="Working Hours Schedule"
                    description="Define standard operational shifts. Overnight schedules are supported."
                  >
                    <button
                      className="flex items-center gap-2 text-xs font-medium text-primary"
                      onClick={() =>
                        update(
                          'schedule',
                          draft.schedule.map((day, index) =>
                            index < 5
                              ? {
                                  ...day,
                                  enabled: draft.schedule[0].enabled,
                                  start: draft.schedule[0].start,
                                  end: draft.schedule[0].end,
                                }
                              : day,
                          ),
                        )
                      }
                    >
                      <Copy size={15} />
                      Copy Monday to all weekdays
                    </button>
                  </Heading>
                  <div className="space-y-2">
                    {draft.schedule.map((day, index) => {
                      const hours = shiftHours(day.start, day.end)
                      return (
                        <div
                          key={day.day}
                          className={`flex flex-wrap items-center gap-3 rounded-xl p-3 ${day.enabled ? 'bg-slate-50' : 'bg-white text-slate-400'}`}
                        >
                          <Toggle
                            small
                            label={`${day.day} working day`}
                            checked={day.enabled}
                            onChange={(value) =>
                              updateDay(index, { enabled: value })
                            }
                          />
                          <strong className="w-20 text-xs font-medium">
                            {day.day}
                          </strong>
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              aria-label={`${day.day} shift start`}
                              className={`${control} w-28 !px-2 !py-1.5`}
                              value={day.start}
                              disabled={!day.enabled}
                              onChange={(event) =>
                                updateDay(index, { start: event.target.value })
                              }
                            />
                            <span className="text-[10px] text-muted">to</span>
                            <input
                              type="time"
                              aria-label={`${day.day} shift end`}
                              className={`${control} w-28 !px-2 !py-1.5`}
                              value={day.end}
                              disabled={!day.enabled}
                              onChange={(event) =>
                                updateDay(index, { end: event.target.value })
                              }
                            />
                          </div>
                          <span
                            className={`ml-auto rounded-full px-2 py-1 text-[10px] ${!day.enabled ? 'bg-slate-100 text-muted' : hours === null ? 'bg-red-50 text-error' : 'bg-green-50 text-green-800'}`}
                          >
                            {!day.enabled
                              ? 'Weekend / Off'
                              : hours === null
                                ? 'Check shift times'
                                : `${hours.toFixed(1)} hr shift${day.end < day.start ? ' · Overnight' : ''}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
              {show('categories') && (
                <section id="settings-categories" className={panel}>
                  <Heading
                    title="Application Category Rules"
                    description="Classify desktop software into productivity buckets across organizational units."
                  >
                    <Button
                      type="button"
                      variant="primary"
                      aria-expanded={addingRule}
                      onClick={() => {
                        setAddingRule((value) => !value)
                        setRuleError('')
                      }}
                    >
                      <Plus size={16} />
                      Add rule
                    </Button>
                  </Heading>
                  {addingRule && (
                    <form
                      onSubmit={addRule}
                      className="mb-5 grid gap-3 rounded-xl bg-soft p-4 sm:grid-cols-2"
                    >
                      <label className="text-xs">
                        Application name
                        <input
                          required
                          maxLength={100}
                          name="name"
                          placeholder="e.g. Notion"
                          className={`${control} mt-1 w-full`}
                        />
                      </label>
                      <label className="text-xs">
                        Category
                        <select
                          name="category"
                          className={`${control} mt-1 w-full`}
                        >
                          {['Productive', 'Neutral', 'Unproductive'].map(
                            (category) => (
                              <option key={category}>{category}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label className="text-xs">
                        Applied scope
                        <select
                          name="scope"
                          className={`${control} mt-1 w-full`}
                        >
                          <option>All Departments</option>
                          {employeeDepartments.map((department) => (
                            <option key={department}>{department}</option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-end gap-2">
                        <Button variant="primary" type="submit">
                          Add rule
                        </Button>
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => setAddingRule(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                      {ruleError && (
                        <p
                          role="alert"
                          className="text-xs text-error sm:col-span-2"
                        >
                          {ruleError}
                        </p>
                      )}
                    </form>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[530px] text-left text-xs">
                      <thead className="bg-soft text-[10px] uppercase tracking-wide text-muted">
                        <tr>
                          {[
                            'Application Name',
                            'Productivity Category',
                            'Applied Scope',
                            'Action',
                          ].map((title) => (
                            <th className="px-4 py-4 font-semibold" key={title}>
                              {title}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {draft.rules.map((rule) => (
                          <tr key={rule.id}>
                            <td className="px-4 py-5">
                              <span className="flex items-center gap-3">
                                <span className="rounded bg-primary/10 p-1.5 text-primary">
                                  <Code2 size={15} />
                                </span>
                                {rule.name}
                              </span>
                            </td>
                            <td className="px-4 py-5">
                              <select
                                aria-label={`${rule.name} category for ${rule.scope}`}
                                className={`rounded-full px-2 py-1 text-[10px] ${rule.category === 'Productive' ? 'bg-green-50 text-green-800' : rule.category === 'Neutral' ? 'bg-indigo-100 text-indigo-800' : 'bg-red-50 text-error'}`}
                                value={rule.category}
                                onChange={(event) =>
                                  update(
                                    'rules',
                                    draft.rules.map((item) =>
                                      item.id === rule.id
                                        ? {
                                            ...item,
                                            category: event.target.value,
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                {['Productive', 'Neutral', 'Unproductive'].map(
                                  (category) => (
                                    <option key={category}>{category}</option>
                                  ),
                                )}
                              </select>
                            </td>
                            <td className="px-4 py-5 text-muted-strong">
                              {rule.scope}
                            </td>
                            <td className="px-4 py-5">
                              <button
                                className="rounded-lg p-1 text-muted hover:bg-red-50 hover:text-error"
                                aria-label={`Delete ${rule.name} rule for ${rule.scope}`}
                                onClick={() =>
                                  update(
                                    'rules',
                                    draft.rules.filter(
                                      (item) => item.id !== rule.id,
                                    ),
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!draft.rules.length && (
                      <p className="p-8 text-center text-xs text-muted">
                        No application rules. Add a rule to get started.
                      </p>
                    )}
                  </div>
                </section>
              )}
              {show('privacy') && (
                <section id="settings-privacy" className={panel}>
                  <Heading
                    title="Data & Privacy"
                    description="Manage retention preferences, consent and employee disclosure documentation."
                  />
                  <label className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 p-4">
                    <div className="max-w-sm">
                      <strong className="text-xs font-semibold text-ink">
                        Audit Data Retention Period
                      </strong>
                      <p className="mt-1 text-xs leading-relaxed text-muted-strong">
                        Requested duration that aggregate metrics remain
                        available.
                      </p>
                    </div>
                    <select
                      className={control}
                      value={draft.retentionDays}
                      onChange={(event) =>
                        update('retentionDays', Number(event.target.value))
                      }
                    >
                      {[30, 60, 90, 180, 365].map((days) => (
                        <option value={days} key={days}>
                          {days} days{days === 90 ? ' (Recommended)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="my-4">
                    <ToggleRow
                      Icon={Shield}
                      title="Require employee consent before tracking"
                      description="Request transparent disclosure and employee consent before enabling telemetry."
                      checked={draft.requireConsent}
                      onChange={(value) => update('requireConsent', value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold text-ink">
                        Employee Transparency Documentation
                      </h3>
                      <p className="mt-1 text-[10px] text-muted">
                        Local draft · No policy has been published
                      </p>
                    </div>
                    <button
                      className="flex items-center gap-1 text-xs text-primary"
                      aria-expanded={policyEditing}
                      onClick={() => setPolicyEditing((value) => !value)}
                    >
                      <FileText size={15} />
                      {policyEditing ? 'Close editor' : 'Edit Privacy Policy'}
                    </button>
                  </div>
                  {policyEditing && (
                    <label className="mt-4 block text-xs font-medium">
                      Policy draft
                      <textarea
                        className={`${control} mt-2 min-h-40 w-full leading-relaxed`}
                        maxLength={5000}
                        value={draft.policy}
                        onChange={(event) =>
                          update('policy', event.target.value)
                        }
                      />
                    </label>
                  )}
                  <div className="mt-6 flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
                    <Info size={19} className="shrink-0 text-amber-600" />
                    <p>
                      <strong className="mb-1 block font-semibold">
                        Transparent Monitoring Architecture
                      </strong>
                      Production monitoring should provide a visible status
                      indicator and obtain appropriate consent. This settings
                      preview does not capture activity or change a desktop
                      agent.
                    </p>
                  </div>
                </section>
              )}
              {show('notifications') && (
                <section id="settings-notifications" className={panel}>
                  <Heading
                    title="Notifications"
                    description="Choose which operational alerts you would like to receive. Delivery requires a connected backend."
                  />
                  <ToggleRow
                    Icon={Bell}
                    title="Idle threshold alerts"
                    description="Notify administrators when an employee exceeds the configured idle threshold."
                    checked={draft.notifyIdle}
                    onChange={(value) => update('notifyIdle', value)}
                  />
                  <ToggleRow
                    Icon={Bell}
                    title="Agent offline alerts"
                    description="Notify administrators when a desktop agent stops reporting."
                    checked={draft.notifyAgentOffline}
                    onChange={(value) => update('notifyAgentOffline', value)}
                  />
                  <ToggleRow
                    Icon={FileText}
                    title="Weekly summary digest"
                    description="Request a weekly overview of activity metrics. No emails are sent by this preview."
                    checked={draft.weeklyDigest}
                    onChange={(value) => update('weeklyDigest', value)}
                  />
                </section>
              )}
              {show('security') && (
                <section id="settings-security" className={panel}>
                  <Heading
                    title="Security"
                    description="Draft security preferences. These controls do not enforce authentication in the current preview."
                  />
                  <label className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
                    <div>
                      <strong className="text-xs font-semibold text-ink">
                        Session Timeout
                      </strong>
                      <p className="mt-1 text-xs text-muted-strong">
                        Requested inactive session expiration period.
                      </p>
                    </div>
                    <select
                      className={control}
                      value={draft.sessionMinutes}
                      onChange={(event) =>
                        update('sessionMinutes', Number(event.target.value))
                      }
                    >
                      {[15, 30, 60, 120].map((minutes) => (
                        <option value={minutes} key={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                  <ToggleRow
                    Icon={LockKeyhole}
                    title="Require multi-factor authentication"
                    description="Record the desired MFA policy. Backend authentication support is required to enforce it."
                    checked={draft.requireMfa}
                    onChange={(value) => update('requireMfa', value)}
                  />
                </section>
              )}
              {show('roles') && (
                <section id="settings-roles" className={panel}>
                  <Heading
                    title="User Roles"
                    description="Roles already defined in the project. Backend middleware must enforce permissions."
                  />
                  <div className="grid gap-3 sm:grid-cols-3">
                    {employeeRoles.map((role) => (
                      <div
                        key={role}
                        className="rounded-xl border border-line bg-slate-50 p-4"
                      >
                        <UsersRound size={20} className="text-primary" />
                        <h3 className="mt-2 text-sm font-semibold">{role}</h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted">
                          Existing role · No permission assignments are changed
                          here.
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </main>
        <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-line/80 bg-white/95 px-6 py-4 shadow-[0_-8px_30px_-20px_rgba(15,23,42,0.3)] backdrop-blur">
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-medium ${dirty ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}
            role="status"
          >
            <CheckCircle2 size={14} />
            {dirty
              ? 'Unsaved changes'
              : lastSaved
                ? 'Settings saved in this browser'
                : 'Preview settings · Browser only'}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <button
              className="rounded-lg px-3 py-2 text-xs text-ink hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
              disabled={!dirty}
              onClick={discard}
            >
              Discard changes
            </button>
            <Button
              type="button"
              variant="primary"
              className="disabled:cursor-default disabled:opacity-50"
              disabled={!dirty}
              onClick={save}
            >
              <Save size={15} />
              Save Settings
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
