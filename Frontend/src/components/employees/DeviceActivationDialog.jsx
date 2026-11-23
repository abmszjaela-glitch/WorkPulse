import { useState } from 'react'
import Modal from '../ui/Modal.jsx'
import useAuth from '../../hooks/useAuth.js'
import { apiRequest } from '../../services/api.js'
import { fieldClass, actionClass } from '../../utils/analytics.js'

export default function DeviceActivationDialog({ employee, onClose }) {
  const { session } = useAuth()
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const provision = async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await apiRequest(
        session.accessToken,
        '/devices/provision',
        { method: 'POST', body: { employeeId: employee.id } },
      )
      setCode(`wp1.${result.deviceId}.${result.credential}`)
      setMessage(
        'Device authorized for this employee. Share this code securely; it will not be retained on this page after closing.',
      )
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      onClose={() => !busy && onClose()}
      titleId="device-activation-title"
      className="m-auto w-[min(480px,calc(100%_-_32px))] rounded-2xl bg-white p-6 shadow-floating"
    >
      <h2 id="device-activation-title" className="text-lg font-semibold">
        Connect employee Agent
      </h2>
      <p className="my-3 text-sm">
        {employee.name} · {employee.employeeCode}
      </p>
      <p className="mb-4 text-sm text-muted">
        The employee signs in to WorkPulse Agent, opens Connect device, and
        pastes the code once. Provisioning does not start monitoring.
      </p>
      {code ? (
        <>
          <label className="block text-sm">
            Activation code
            <input
              className={`${fieldClass} mt-2 w-full font-mono text-xs`}
              aria-label="Agent activation code"
              readOnly
              value={code}
            />
          </label>
          <button
            type="button"
            className={`${fieldClass} mt-3`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code)
                setMessage(
                  'Activation code copied. Share it only with this employee.',
                )
              } catch {
                setMessage('Select the activation code and copy it manually.')
              }
            }}
          >
            Copy activation code
          </button>
        </>
      ) : (
        <button className={actionClass} disabled={busy} onClick={provision}>
          {busy ? 'Authorizing…' : 'Generate activation code'}
        </button>
      )}
      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
      <div className="mt-5 text-right">
        <button
          type="button"
          className={fieldClass}
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
