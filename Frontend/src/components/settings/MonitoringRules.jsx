import { Grid2X2, Keyboard, Mouse, Moon, Shield } from 'lucide-react'
import Heading from '../ui/SectionHeading.jsx'
import ToggleRow from './ToggleRow.jsx'
const control =
  'rounded-lg border border-line/60 bg-white px-3 py-2.5 text-xs text-ink outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10'
const panel =
  'scroll-mt-6 rounded-2xl border border-line/60 bg-white p-5 shadow-card sm:p-6'

export default function MonitoringRules({ draft, update }) {
  return (
    <section id="settings-monitoring" className={panel}>
      <Heading
        title="Monitoring Rules"
        description="Define inactivity timeouts, tracking frequency and telemetry capture preferences."
      >
        <span className="rounded-full bg-soft px-2 py-1 text-[10px] text-primary">
          Draft policy
        </span>
      </Heading>
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label
              htmlFor="idle-threshold"
              className="text-xs font-semibold text-ink"
            >
              Idle Threshold Timeout
            </label>
            <p className="mt-1 text-xs leading-relaxed text-muted-strong">
              Employee state changes to inactive after continuous peripheral
              absence.
            </p>
          </div>
          <output
            htmlFor="idle-threshold"
            className="whitespace-nowrap rounded-lg bg-white px-3 py-2 text-sm font-semibold"
          >
            {draft.idleMinutes}{' '}
            <span className="ml-2 text-xs font-normal text-muted">min</span>
          </output>
        </div>
        <input
          id="idle-threshold"
          type="range"
          min={1}
          max={30}
          value={draft.idleMinutes}
          onChange={(event) =>
            update('idleMinutes', Number(event.target.value))
          }
          className="mt-4 h-2 w-full cursor-pointer accent-primary"
        />
        <div className="mt-1 flex justify-between text-[9px] text-muted">
          <span>1 min (High Sensitivity)</span>
          <span>15 min</span>
          <span>30 min (Relaxed)</span>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="rounded-xl bg-slate-50 p-4">
          <strong className="block text-xs font-semibold text-ink">
            Desktop Evaluation Frequency
          </strong>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-strong">
            Frequency of foreground context and heartbeat evaluation.
          </span>
          <select
            className={`${control} mt-3 w-full`}
            value={draft.evaluationSeconds}
            onChange={(event) =>
              update('evaluationSeconds', Number(event.target.value))
            }
          >
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute (Standard Recommended)</option>
            <option value={120}>2 minutes</option>
            <option value={300}>5 minutes</option>
          </select>
        </label>
        <label className="rounded-xl bg-slate-50 p-4">
          <strong className="block text-xs font-semibold text-ink">
            Data Sync Batch Interval
          </strong>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-strong">
            Transmission cadence for aggregate telemetry.
          </span>
          <select
            className={`${control} mt-3 w-full`}
            value={draft.syncMinutes}
            onChange={(event) =>
              update('syncMinutes', Number(event.target.value))
            }
          >
            {[1, 5, 15, 30].map((value) => (
              <option key={value} value={value}>
                {value} minute{value > 1 ? 's' : ''}
                {value === 5 ? ' (Optimized Throughput)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3 className="mb-1 mt-8 text-[10px] font-medium uppercase tracking-wider text-muted">
        Telemetry Ingestion Gates
      </h3>
      <ToggleRow
        Icon={Grid2X2}
        title="Track application usage"
        description="Record foreground application names and active usage duration. No window contents are captured by this preview."
        checked={draft.trackApplications}
        onChange={(value) => update('trackApplications', value)}
      />
      <ToggleRow
        Icon={Keyboard}
        title="Track keyboard activity counts only"
        description="Aggregate keystroke occurrences per interval without registering key codes or sequences."
        checked={draft.trackKeyboardCounts}
        onChange={(value) => update('trackKeyboardCounts', value)}
      >
        <span className="mt-2 inline-flex items-center gap-1 rounded bg-green-50 px-2 py-1 text-[9px] text-green-800">
          <Shield size={12} />
          Counts only · No text or character payloads
        </span>
      </ToggleRow>
      <ToggleRow
        Icon={Mouse}
        title="Track mouse activity dynamics"
        description="Aggregate interaction frequency and click counts without capturing screen coordinates."
        checked={draft.trackMouseCounts}
        onChange={(value) => update('trackMouseCounts', value)}
      />
      <ToggleRow
        Icon={Moon}
        title="Pause tracking outside working hours"
        description="Suspend background monitoring outside configured shift windows when connected to an agent."
        checked={draft.pauseOutsideHours}
        onChange={(value) => update('pauseOutsideHours', value)}
      />
      <label className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
        <div className="max-w-md">
          <strong className="text-xs font-semibold text-ink">
            Client Offline Storage Limit
          </strong>
          <p className="mt-1 text-xs leading-relaxed text-muted-strong">
            Local telemetry retention limit during network disconnections.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted">
          <input
            aria-label="Offline storage limit in days"
            type="number"
            min={1}
            max={30}
            step={1}
            value={draft.offlineDays}
            onChange={(event) =>
              update(
                'offlineDays',
                event.target.value === '' ? '' : Number(event.target.value),
              )
            }
            className={`${control} w-16 text-center`}
          />
          days
        </span>
      </label>
    </section>
  )
}
