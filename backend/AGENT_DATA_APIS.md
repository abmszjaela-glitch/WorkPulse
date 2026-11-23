# WorkPulse desktop agent data APIs

Phase 4 backend ingestion is implemented and tested in isolation. All five routes
require registered-device authentication. The actual desktop application remains
unchanged and does not yet send HTTP requests. Live activation is pending approved
migrations and authentication configuration; no live database writes were performed.

## Existing agent contract inspected

Agent version: **1.0.0**. Inspected `core/activity_record.py`, `core/offline_queue.py`,
`tracker/activity_calculator.py`, `tracker/app_usage_tracker.py`, `core/agent.py`,
`auth/token_store.py`, the tray/desktop code and centralized agent configuration.

The calculator returns an aggregate dictionary. The queue serializer wraps it with
`record_id`, `employee_id`, timezone-aware `interval_start` and `interval_end`.
`retrieve_pending()` adds `sync_status`. Record IDs default to deterministic UUIDv5
values; caller-provided UUIDs are also supported. Application usage is an interval
mapping in `summary.application_usage_seconds`, not a flat `{application,duration}`
HTTP record. Optional calibration and cumulative usage fields exist in calculator
output; the queue strips calibration/cumulative fields before storing an interval.

The running agent currently prints calculator summaries. It does not connect those
summaries to `OfflineQueue`, and has no `data_sender.py`, HTTP login adapter,
device-token enrollment, refresh integration or network heartbeat/status sender.
The UI explicitly disables backend sign-in. Its Windows token store caches an
access token only and explicitly does not verify JWTs. No existing wire protocol
or working end-to-end synchronization is claimed.

The fixture [agent-queue-record.json](tests/fixtures/agent-queue-record.json) was
generated from the unchanged agent's pure `canonical_record()` serializer using
synthetic data, without listeners, local databases, network calls or bytecode writes.
No new request fields were invented for flat application usage or client timestamps.

## Implemented endpoints

All paths are under `/api/v1`; headers use `Authorization: Bearer <device JWT>`.

| Endpoint | Request body | Success |
| --- | --- | --- |
| POST `/activity` | One existing queue envelope | 201 accepted; 200 duplicate |
| POST `/activity/batch` | Direct JSON array returned by `retrieve_pending()` | 200 all successful; 207 per-record failures |
| POST `/app-usage` | Same complete queue envelope, including its application mapping | 201 accepted; 200 duplicate |
| POST `/app-usage/batch` | Direct array of complete queue envelopes | 200 or 207 |
| POST `/status` | `{ "status": "ACTIVE" }`, `IDLE`, `PAUSED` or `OFFLINE` | 200 with persisted event and presence |

The two upload resource groups are compatible ingestion entry points for the SAME
durable interval, including its app usage. Sending an envelope through both does
not add counts/durations twice. There is no agent-generated standalone app-usage
wire format to reuse. Flattened app records or bare calculator summaries lack the
queue's ID/UTC boundaries and are rejected rather than assigned invented metadata.

Status reuses the existing `status` field and adds the explicitly requested PAUSED
and OFFLINE values. Because the agent has no status-event HTTP envelope or source
timestamp, this endpoint records a current transition at server time. An optional
UUID `Idempotency-Key` header protects retries; without it, each POST creates an
event. Unknown fields, including client identity or made-up timestamp fields, fail.
Offline historical pause/resume events cannot be reconstructed from current agent
data and are not fabricated.

## Observed request and response examples

[phase4-http-examples.json](reports/phase4-http-examples.json) contains actual local
HTTP requests and responses captured by the integration tests for all five routes
plus heartbeat. Identities are synthetic and authorization secrets are omitted.
They are not claimed to be production requests or messages from a running desktop.

The single-activity example uses the agent's existing field names and types:

```json
{
  "record_id": "27bf0a65-d9ff-4709-9714-e45aa7489c75",
  "employee_id": "4d7f8b0c-7924-428d-b069-a68d07a6d6fb",
  "interval_start": "2026-11-19T06:44:56.123456+00:00",
  "interval_end": "2026-11-19T06:45:56.123456+00:00",
  "summary": {
    "interval_seconds": 60,
    "counts": { "mouse_movements": 120, "mouse_clicks": 3, "key_presses": 44 },
    "active_seconds": 50,
    "idle_seconds": 10,
    "application_usage_seconds": { "code.exe": 45 },
    "status": "ACTIVE",
    "activity_score": 21.5,
    "score_type": "input_activity_intensity",
    "score_is_productivity_or_performance": false
  },
  "sync_status": "pending"
}
```

Its observed HTTP 201 response:

```json
{
  "acknowledged_record_ids": ["27bf0a65-d9ff-4709-9714-e45aa7489c75"],
  "results": [{ "index": 0, "status": "accepted", "record_id": "27bf0a65-d9ff-4709-9714-e45aa7489c75", "http_status": 201 }]
}
```

Use actual authenticated employee IDs in integration, not these synthetic IDs.
Examples are regenerated on monitoring test runs; inspect the JSON for that run's
exact timestamps/IDs and the mixed-success batch response.

## Authentication, authorization and privacy

Phase 2 human login issues a human token, never an unrestricted Agent token.
Trusted operator/Admin provisioning creates a device-specific random credential
whose hash is stored. The internal device login exchange and Phase 3 registration
establish a device-bound JWT/session; registration also requires the current device
secret and atomically rotates it. No new public enrollment bypass is introduced.

Monitoring verifies JWT signature, issuer, device audience, expiry and durable
session. It checks active employee, exact device ownership, active/nondeleted device,
registration and session revocation again inside the persistence transaction.
Only authenticated Agent contexts reach ingestion. Device credentials/tokens are
never accepted inside monitoring payloads or logged. Disabled/removed devices and
expired/revoked sessions cannot submit data or heartbeat.

Payload `employee_id` must match the authenticated user UUID or that user's assigned
employee code; it cannot select another employee. Database ownership is always the
authenticated identity/device. The queue does not contain its originating device
ID, so the backend binds it to the uploading device and cannot prove original
collection on a different device. A future sender must keep queues device-scoped.

New interval data requires the privacy-policy receipt applicable at collection time,
accepted before the interval starts. Offline uploads under an older valid policy
remain valid after a newer version is published. Intervals crossing a policy change
without timely consent are rejected and reported, not silently reassigned or erased.
Current ACTIVE/IDLE reports require current consent; PAUSED/OFFLINE remain permitted
without consent so stopping is never blocked. Calibration metadata and cumulative
app totals are not persisted or added to interval totals. Scores remain explicitly
input intensity, never productivity or employee performance.

Only aggregate numeric counts, durations, process names, interval times and status
are stored. Unknown fields, key contents, window titles, paths, URLs and screenshots
are rejected. Logs exclude request bodies, secrets and query strings.

## Reliability and validation

Record identity is unique per device/UUID, with a second uniqueness constraint on
device/start/end. A content fingerprint uses normalized UTC microsecond timestamps
and safe interval data. Equivalent timezone representations and field ordering do
not change its meaning. Exact retries return duplicate acknowledgments. Reusing an
ID with changed data, a different ID for the same interval, or overlapping intervals
returns 409 without overwriting data. Previously accepted records remain acknowledgeable
after upload-age limits become stricter. The entire accepted interval and all its
application rows persist in the same database transaction.

Batch validation reports each input index and record ID, including invalid records.
Expected record failures use database savepoints; valid records commit together.
An unexpected database/storage failure rolls back the whole transaction and returns
503 with no acknowledgments. The server never acknowledges before commit. A 207 is
still a 2xx response: **the sender must mark/delete ONLY IDs in
`acknowledged_record_ids`, never every submitted record.** Retain failures for retry
or explicit resolution. Network failures, 429 and 503 require retained records and
backoff; a lost response is recovered by retrying the same IDs/content.

Central limits live in `config/monitoring.js` and `.env.example`: default 100 records
per batch, 256 KiB per record, 30-day upload age, 24-hour maximum interval, 5-minute
future clock skew, 5-second wall-clock/duration and app-accounting tolerance, and
120 requests/minute/device. Existing global JSON middleware limits requests to
1 MiB, so senders must also bound encoded batch bytes. Counts must be non-negative
safe JSON integers; unsafe large numbers are rejected instead of rounded, though
the Python queue supports larger signed-64-bit values. Durations must be finite,
nonnegative and active+idle must match the interval within the agent's numerical
tolerance. Zero-duration intervals cannot contain events or app usage. Application
names follow the existing 255-Unicode-code-point process-name contract (max 256 apps).

UTC timezone offsets and microseconds are preserved; naive/invalid dates, excessive
future/stale times, impossible totals and inconsistent boundaries fail explicitly.
No client timestamps are changed to hide an invalid interval.

## Database proposal and heartbeat integration

The read-only Supabase OpenAPI inspection again returned HTTP 200 with no exposed
tables/RPCs. This does not prove private schemas are empty. Review the full schema
and [003_monitoring.proposed.sql](migrations/003_monitoring.proposed.sql) after 001
and 002. None has been applied; explicit approval is still required.

| Table | Data and relationships |
| --- | --- |
| `wp_activity_intervals` | Device/record composite key, employee FK, UTC boundaries, interval/active/idle seconds, three bigint counters, safe summary, content hash, server receive time |
| `wp_application_usage` | Device/record/application composite key, duration; FK to its interval supplies employee/device and actual aggregate interval timestamps |
| `wp_status_events` | Device/record composite key, employee FK, one of four distinct states, server transition time |
| `wp_device_presence` | Device PK/FK, latest explicitly reported state and timestamp |

Existing `wp_auth_users`, `wp_auth_devices`, `wp_auth_sessions`, employee profile,
privacy policies and receipts are reused. No password or device-secret duplicates
are created. Tables use RLS deny policies and service-role-only grants/RPCs. Explicit
constraints/indexes cover nonnegative finite data, employee/time queries and unique
record/interval keys. No automatic deletion or idempotency-record purge is added;
any future retention job must preserve retry guarantees and be separately reviewed.

The migration preserves/renames the existing core device RPC as a base function and
wraps its results without changing paths or existing response fields. Heartbeat,
device list/detail, agent config and status share one device-state calculation.
`last_seen` updates only from registered authorized device traffic, using server time.
The configurable default offline timeout is 300 seconds. No polling worker is needed.

`connectionState` is network liveness; `reportedStatus` is the actual last requested
monitoring state. `effectiveStatus` becomes OFFLINE on timeout or disabled identity;
otherwise it preserves reported ACTIVE/IDLE/PAUSED/OFFLINE. A fresh connection can
still explicitly report OFFLINE while shutting down. Heartbeat never invents ACTIVE
or changes PAUSED to IDLE. Before the first status report, the reported state is
unknown/null. Timeout transitions are calculated at read time, not fabricated into
the explicit event ledger. Historical interval uploads cannot overwrite current status.

## Required agent integration work — report only

1. Configure `SERVER_URL` to the actual `/api/v1` backend base; its current default
   ends `/api`. Implement the currently missing backend login/enrollment adapter
   and secure storage/refresh of device credentials and sessions. The existing
   access-token cache alone is not authenticated enrollment or a refresh implementation.
2. Connect calculator output to `OfflineQueue.insert()` with real captured UTC
   boundaries, authoritative employee ID and stable IDs. The running agent currently
   prints summaries and does not wire the encrypted queue into its tracking loop.
   Keep queues associated with their originating authenticated device.
3. Add a nonblocking HTTP sender using `retrieve_pending()`, bounded arrays, device
   JWTs, per-record acknowledgments, retry/backoff and token expiry handling. Preserve
   counts as intervals; never upload cumulative usage as additional interval data.
4. Integrate server privacy-policy/consent acceptance and authorized configuration
   before collecting; preserve existing visible controls, working hours and manual stop.
5. Send heartbeat and explicit current status changes. Historical pause/offline
   transitions need a separately designed event envelope if later required; current
   queue records do not contain those events. No historical timestamps are invented.

None of this agent work was performed. A running desktop-to-live-backend test is
therefore NOT TESTED and requires a future explicit agent integration request.

## Verification and files

`npm test`: **82 PASS, 0 FAIL** (58 existing + 24 monitoring tests). The monitoring
suite uses the exact 001+002+003 SQL in isolated PostgreSQL (PGlite), real local HTTP,
production controllers/services/repositories and a synthetic fixture generated from
the actual Python serializer. It covers all five endpoints, authentication, device
revocation/registration, batches, duplicates, conflicts, microseconds/Unicode,
offline retries, historic/current consent, transaction rollback, four states,
heartbeat recovery, RLS and rate limits. Multi-process concurrency/load performance
is not claimed by local concurrent-request tests.

Configured backend startup, health and 404 checks passed; all five data routes fail
closed with 503 while signing configuration remains absent. Live migration, live
data persistence and real desktop synchronization are NOT TESTED. No dependencies
were added in Phase 4. Existing productivity metrics remain pending a reviewed
classification/definition; aggregate input counts are not substituted for them.

Added: monitoring config/runtime, controller, router, repository, validation/service,
003 migration, monitoring tests/serializer fixture and HTTP/results reports.
Modified: `app.js`, `services/core-repository.js` (shared offline timeout), `.env.example`
and repository documentation. Agent and frontend source files remain unchanged.
