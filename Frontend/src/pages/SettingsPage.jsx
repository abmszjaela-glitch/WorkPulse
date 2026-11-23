import { useState } from 'react'
import useAuth from '../hooks/useAuth.js'
import useApiData from '../hooks/useApiData.js'
import { apiRequest } from '../services/api.js'
import {
  ApiPage,
  Panel,
  ApiTable,
  Pagination,
} from '../components/data/ApiView.jsx'
import { fieldClass, actionClass } from '../utils/analytics.js'

const monitoringFields = {
  idleMinutes: 'Idle threshold (minutes)',
  evaluationSeconds: 'Activity interval (seconds)',
  syncMinutes: 'Sync interval (minutes)',
  offlineDays: 'Offline retention (days)',
  trackApplications: 'Track application names and durations',
  trackKeyboardCounts: 'Track anonymous key counts',
  trackMouseCounts: 'Track mouse counts',
  pauseOutsideHours: 'Pause outside working hours',
}
const choices = {
  evaluationSeconds: [30, 60, 120, 300],
  syncMinutes: [1, 5, 15, 30],
  retentionDays: [30, 60, 90, 180, 365],
}
function SettingsSection({ title, section, fields, value, token, onSaved }) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(Object.keys(fields).map((key) => [key, value[key]])),
  )
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await apiRequest(token, `/settings/${section}`, {
        method: 'PUT',
        body: draft,
      })
      setMessage('Settings saved to the backend.')
      onSaved()
    } catch (failure) {
      setMessage(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={title}>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          {Object.entries(fields).map(([key, label]) => (
            <label key={key} className="text-sm">
              {label}
              {typeof draft[key] === 'boolean' ? (
                <input
                  className="ml-3"
                  type="checkbox"
                  checked={draft[key]}
                  disabled={key === 'requireConsent'}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.checked })
                  }
                />
              ) : choices[key] ? (
                <select
                  className={`${fieldClass} mt-2 w-full`}
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: Number(e.target.value) })
                  }
                >
                  {choices[key].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${fieldClass} mt-2 w-full`}
                  type="number"
                  required
                  min={1}
                  max={
                    key === 'idleMinutes' || key === 'offlineDays'
                      ? 30
                      : undefined
                  }
                  value={draft[key] ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: Number(e.target.value) })
                  }
                />
              )}
            </label>
          ))}
          <div className="sm:col-span-2">
            <button className={actionClass}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            {message && (
              <p role="status" className="mt-3 text-sm">
                {message}
              </p>
            )}
          </div>
        </fieldset>
      </form>
    </Panel>
  )
}
function WorkingHours({ value, token, onSaved }) {
  const [zone, setZone] = useState(value.timezone || '')
  const [schedule, setSchedule] = useState(
    () =>
      value.schedule ||
      [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ].map((day) => ({ day, enabled: false, start: '', end: '' })),
  )
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const change = (index, key, next) =>
    setSchedule((previous) =>
      previous.map((row, i) => (i === index ? { ...row, [key]: next } : row)),
    )
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await apiRequest(token, '/settings/working-hours', {
        method: 'PUT',
        body: { timezone: zone, schedule },
      })
      setMessage(
        'Working hours saved. Connected agents reload the policy and pause before an explicit restart.',
      )
      onSaved()
    } catch (failure) {
      setMessage(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel
      title="Working hours"
      subtitle="IANA timezone and explicit daily shifts; disabled days collect no activity"
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm">
            Timezone
            <input
              className={`${fieldClass} ml-3`}
              required
              placeholder="IANA timezone"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={fieldClass}
            disabled={!schedule[0].start || !schedule[0].end}
            onClick={() =>
              setSchedule((previous) =>
                previous.map((row) => ({
                  ...row,
                  start: previous[0].start,
                  end: previous[0].end,
                })),
              )
            }
          >
            Copy Monday times to all days
          </button>
          {schedule.map((row, index) => (
            <div
              key={row.day}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-soft p-3 text-sm"
            >
              <label className="w-32">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={row.enabled}
                  onChange={(e) => change(index, 'enabled', e.target.checked)}
                />
                {row.day}
              </label>
              <label>
                Start{' '}
                <input
                  type="time"
                  required
                  className={fieldClass}
                  value={row.start}
                  onChange={(e) => change(index, 'start', e.target.value)}
                />
              </label>
              <label>
                End{' '}
                <input
                  type="time"
                  required
                  className={fieldClass}
                  value={row.end}
                  onChange={(e) => change(index, 'end', e.target.value)}
                />
              </label>
            </div>
          ))}
          <button className={actionClass}>
            {busy ? 'Saving…' : 'Save working hours'}
          </button>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </fieldset>
      </form>
    </Panel>
  )
}
function PrivacyPolicy({ policy, token, onSaved }) {
  const [content, setContent] = useState(policy?.content || ''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <Panel
      title="Employee privacy policy"
      subtitle={
        policy
          ? `Current version: ${policy.version}. Publishing a new version requires fresh employee consent.`
          : 'Publish the actual organization policy before activating monitoring.'
      }
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await apiRequest(token, '/consent/policy', {
              method: 'PUT',
              body: { content },
            })
            setMessage('Policy version published.')
            onSaved()
          } catch (failure) {
            setMessage(failure.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <textarea
          className={`${fieldClass} min-h-40 w-full`}
          aria-label="Privacy policy content"
          required
          minLength={1}
          maxLength={50000}
          value={content}
          disabled={busy}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className={`${actionClass} mt-3`}
          disabled={busy || content === policy?.content}
        >
          {busy ? 'Publishing…' : 'Publish policy version'}
        </button>
        {message && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </form>
    </Panel>
  )
}
function CategoryRules({ resource, token, page, onPage }) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const write = async (method, path, body) => {
    setBusy(true)
    try {
      await apiRequest(token, path, { method, body })
      resource.reload()
      setMessage('Classification rule saved.')
    } catch (failure) {
      setMessage(failure.message)
    } finally {
      setBusy(false)
    }
  }
  const add = async (e) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await write('POST', '/app-categories', {
      applicationName: form.get('applicationName'),
      category: form.get('category'),
      departmentId: null,
    })
  }
  return (
    <Panel
      title="Application category rules"
      subtitle="Global process-name rules; unmatched applications stay Unclassified"
    >
      <form onSubmit={add} className="mb-4 flex flex-wrap gap-3">
        <input
          className={fieldClass}
          name="applicationName"
          aria-label="Application process name"
          placeholder="Process name, e.g. editor.exe"
          required
          maxLength={255}
        />
        <select
          name="category"
          aria-label="New application category"
          className={fieldClass}
        >
          {['Productive', 'Neutral', 'Unproductive'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button className={actionClass} disabled={busy}>
          Add rule
        </button>
      </form>
      {message && (
        <p role="status" className="my-3 text-sm">
          {message}
        </p>
      )}
      <ApiTable
        rows={resource.data.categories?.items || []}
        columns={[
          ['Application', 'application_name'],
          ['Scope', (row) => row.department_id || 'All departments'],
          [
            'Category',
            (row) => (
              <select
                className={fieldClass}
                value={row.category}
                disabled={busy}
                aria-label={`Category for ${row.application_name}`}
                onChange={(e) =>
                  write('PUT', `/app-categories/${row.id}`, {
                    category: e.target.value,
                  })
                }
              >
                {['Productive', 'Neutral', 'Unproductive'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ),
          ],
          [
            'Action',
            (row) => (
              <button
                className="text-error"
                disabled={busy}
                onClick={() => write('DELETE', `/app-categories/${row.id}`)}
              >
                Delete
              </button>
            ),
          ],
        ]}
      />
      <Pagination
        page={page}
        pageSize={20}
        total={resource.data.categories?.total}
        onPage={onPage}
      />
    </Panel>
  )
}
export default function SettingsPage() {
  const { session } = useAuth()
  const [page, setPage] = useState(1)
  const resource = useApiData(
    {
      settings: '/settings',
      privacy: '/consent/policy',
      categories: `/app-categories?page=${page}&pageSize=20`,
      roles: '/settings/roles',
    },
    { refreshMs: 30000 },
  )
  const values = resource.data.settings?.data,
    token = session.accessToken
  return (
    <ApiPage
      title="System Settings"
      subtitle="Authorized backend policy applied to connected desktop agents"
      resource={resource}
    >
      {values?.monitoring && (
        <SettingsSection
          key={`monitoring-${values.monitoring.revision}`}
          title="Monitoring rules"
          section="monitoring"
          fields={monitoringFields}
          value={values.monitoring}
          token={token}
          onSaved={resource.reload}
        />
      )}
      {values?.workingHours && (
        <WorkingHours
          key={`hours-${values.workingHours.revision}`}
          value={values.workingHours}
          token={token}
          onSaved={resource.reload}
        />
      )}
      <CategoryRules
        resource={resource}
        token={token}
        page={page}
        onPage={setPage}
      />
      {values?.notifications && (
        <SettingsSection
          key={`notifications-${values.notifications.revision}`}
          title="Organization notifications"
          section="notifications"
          fields={{
            notifyIdle: 'Notify on idle',
            notifyAgentOffline: 'Notify on device offline',
            weeklyDigest: 'Weekly digest preference',
          }}
          value={values.notifications}
          token={token}
          onSaved={resource.reload}
        />
      )}
      {values?.retention && (
        <SettingsSection
          key={`retention-${values.retention.revision}`}
          title="Data retention and consent"
          section="data-retention"
          fields={{
            retentionDays: 'Retention days',
            requireConsent: 'Require employee consent',
          }}
          value={values.retention}
          token={token}
          onSaved={resource.reload}
        />
      )}
      <PrivacyPolicy
        key={resource.data.privacy?.version || 'new-policy'}
        policy={resource.data.privacy}
        token={token}
        onSaved={resource.reload}
      />
      <Panel title="Roles and permissions">
        <ApiTable
          rows={resource.data.roles?.data || []}
          rowKey={(row) => row.role}
          columns={[
            ['Role', 'name'],
            ['Scope', 'scope'],
            ['Permissions', (row) => row.permissions.join(', ')],
          ]}
        />
      </Panel>
    </ApiPage>
  )
}
