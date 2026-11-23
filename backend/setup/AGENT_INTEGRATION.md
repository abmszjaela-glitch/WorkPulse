# Agent → API → Supabase → dashboard

Implementation is connected; live database deployment remains pending approval.
The read-only check on 2026-11-23 found the existing auth/core tables available.
Monitoring, processing, reports, and system tables returned `PGRST205` (unavailable
in the PostgREST schema cache). No employee rows were read or modified by this
check, and no migration has been applied to live Supabase.

## Database review

`AGENT_INTEGRATION_REVIEW.sql` is the complete SQL review artifact. It combines
the existing proposals 003–007, in order, inside one transaction. It preserves
001/002 and existing account/profile data. It adds:

- 003: `wp_activity_intervals`, `wp_application_usage`, `wp_status_events`, and
  `wp_device_presence`; atomic/idempotent uploads and device authorization RPCs.
- 004: category rules, classified duration summaries, durable summary jobs and
  schedule cursors. Productivity scores remain null.
- 005: scoped database analytics and indexes for dashboard/activity/app views.
- 006: report aggregation and `wp_report_exports` history.
- 007: system settings, notifications, audit logs, device connectivity and a
  scoped real-time event outbox; authorized device policy reads.

The original proposals contain the relationships, constraints, indexes, RLS and
server-role grants. Express verifies custom JWTs; the backend service role calls
authorization-enforcing RPCs. Frontend and Agent never receive the Supabase key.
The review bundle refuses an already/partially deployed later schema instead of
duplicating tables. All DDL requires the database owner (Supabase SQL Editor),
not the backend service-role REST key. Back up the project before deployment.
Do not reapply 001/002 and do not execute this bundle without explicit approval.

Regenerate this review artifact after any proposal change:

```powershell
cd C:\Users\DELL\Documents\GitHub\WorkPulse\backend
npm run prepare:agent-database
```

After approval and database-owner execution, refresh the Supabase API schema
cache if necessary, then run `npm run check:agent`. It performs zero-row reads;
it does not create tables or test-write employee records. Table availability is
a prerequisite; actual employee/device login and upload still need verification.

## Activation and data flow

1. Restart the backend and frontend using their existing `npm run dev` commands.
   Port 5000 and the existing `/api/v1` base are preserved.
2. As Admin, open Settings. Configure the actual IANA timezone and seven daily
   working shifts, and publish the actual employee privacy policy. No work
   schedule is silently seeded. Set the desired collection and sync intervals.
3. Create/select the employee in Employees. Click the key icon (`Connect Agent
   for ...`) → Generate activation code. Share that one-time code securely.
4. Install/run the updated Agent. Set `SERVER_URL` to the real HTTPS backend API
   base for remote computers. Loopback HTTP is allowed only for local development.
   `localhost` on another laptop refers to that laptop. Set `DASHBOARD_URL` to the
   actual dashboard address if the tray dashboard link is required.
5. Employee signs in, changes any temporary password, and opens Connect device.
   Paste the activation code, review the organization policy, accept it, and wait
   for the server receipt. Explicitly Start / Resume during configured work hours.
6. The Agent creates UTC intervals from its monotonic clocks, encrypts aggregate
   queue records with current-user DPAPI/restricted ACLs, and uploads them on a
   separate worker using a device JWT. Only exact accepted/duplicate UUIDs are
   deleted after server acknowledgement. Failed records remain queued.
7. The dashboard polls actual APIs every 15 seconds (reports/settings 30 seconds).
   It reflects **uploaded** data; it is not a stream of individual input events.
   Default backend collection is 60 seconds and sync is 5 minutes; Admin may
   choose a 1-minute sync interval. Allow one collection/sync cycle before judging
   the charts. Heartbeats/status updates run independently of queued intervals.

New integration extensions reuse the existing internal auth service/schema:

| Endpoint | Authorization | Body / result |
| --- | --- | --- |
| `POST /devices/provision` | Admin JWT | `{employeeId}` → `{deviceId, credential}` once |
| `POST /devices/token` | Device ID + secret; rate limited | `{deviceId,deviceCredential}` → device-bound JWT |
| `POST /devices/register` | Device JWT + existing secret | Existing contract; rotates credential/session |

Activation format is `wp1.<deviceId>.<credential>`. A normal employee JWT cannot
upload telemetry. Server `/auth/me` verifies the device belongs to the signed-in
employee before activation/upload. Device secrets are scoped to backend/employee
in Windows Credential Manager; queues are separated by backend/employee/device.
The existing reviewed 99 document endpoints are preserved; the two enrollment
extensions are explicitly additional, and covered by authorization tests.

`POST /activity/batch` receives the actual queue array, including process-name
duration totals. The server atomically persists intervals and app usage together;
the Agent does not send the same app usage again to a second endpoint. Counts,
durations and UTC boundaries retain the existing Agent payload field names.
Upload batches are bounded by record count and `SYNC_MAX_BATCH_BYTES` (900 KiB
by default), below the existing 1 MiB Express body limit. Large pending queues
are split without discarding the remaining records.

## Connected pages and truthful limits

- Dashboard: real employee/status counts, active/idle days, category duration
  shares, live status table, top apps and department active time.
- Employees: existing database CRUD plus activity links and Admin device activation.
- Activity Details: employee-scoped KPIs, hourly timeline, trends, process usage
  and paginated movement/click/anonymous-key counts for each interval.
- Application Usage: dates/departments, optional employee table, categories,
  trends, pagination and backend CSV. Charts/export retain the stated department
  scope when an employee table filter is selected.
- Departments: database CRUD/reassignment, account counts and recorded time.
- Reports: real summary/activity/application reports, KPIs, charts, CSV/PDF and
  export history. Input counts remain in Activity Details because the existing
  report contract does not expose them. Files are delivered when generated;
  history metadata is not represented as a retained-file download.
- Settings/privacy/categories: real authorized backend reads and writes; the
  Agent reloads policy every 60 seconds. Collection policy changes require a
  new explicit Start; manual/emergency stops never secretly restart.
- Profile/notifications: existing profile persistence, actual avatar/password/
  session APIs, notification preferences, login sessions and user notifications.

Input intensity is not productivity. No productivity score, attendance ratio,
overtime or paused duration is fabricated from missing data. Active/idle totals
sum device intervals; overlapping simultaneous devices are not deduplicated into
human wall-clock time. Process names/durations are available after synchronization;
the dashboard does not claim an instantaneous current-window feed. Paused periods
collect no input; interval/app clocks freeze before listener cleanup.

Missing-service errors remain visible. No fake empty success or chart data masks
an undeployed database. The queue is bounded by configured capacity/retention;
an enqueue failure stops the run rather than permitting unrecorded monitoring.
Employee access-token expiry pauses collection and requires sign-in again; device
tokens are independently renewed with the securely stored device credential.

## Validation evidence

- `backend/tests/agent-integration.test.js`: production HTTP routers + isolated
  PostgreSQL; provision/rotation, policy, consent, real queue shape, wrong owner,
  partial acknowledgements, replay, dashboard/apps/reports and disabled device.
- `backend/tests/agent-migration.test.js`: complete SQL bundle, account preservation,
  RLS, transaction and duplicate-deployment guard against isolated PostgreSQL.
- `agent/tests/test_data_sender.py`: fake network/vault only; scope, acknowledgement,
  offline preservation, credential validation, policy change and idle/shift behavior.
- `Frontend/tests/e2e/agent-data.spec.js`: explicit HTTP fixtures for desktop/mobile
  rendering and authorized writes/downloads. These are separate from SQL tests;
  they do not claim a live employee upload.
- Reports: `backend/reports/agent-storage-readiness.json`,
  `agent-backend-suite.txt`, `agent-integration-tests.txt`,
  `frontend-integration-rerun.txt`; `agent/reports/integration-tests.txt` and
  `desktop-windowed-results.json`.

The local Windows 11 GUI/no-console smoke checks pass without starting tracking.
Live employee upload, live SQL deployment and clean Windows 10 execution remain
NOT TESTED until the corresponding authorized environment is available.

Final local results: backend 157/157; Agent 225/225; frontend 17/17 unit tests;
22 desktop/mobile regressions plus 2 additional unavailable-service/export checks.
Lint/build and the isolated Windows 11 installer/desktop-shortcut/uninstall
verification pass. `npm test` now runs the PostgreSQL integration files sequentially
to reduce Windows file-lock/resource contention. The consolidated machine-readable
report is `backend/reports/agent-integration-results.json`.
