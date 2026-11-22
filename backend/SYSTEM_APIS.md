# Phase 8: real-time and system APIs

Implementation follows sections 13–17 of **WorkPulse API Endpoints.docx**.
No frontend or Agent files were changed. The existing frontend currently has no
Socket.IO client calls; this phase provides the backend contract only.

Files created: `config/system.js`, `controllers/system-controller.js`,
`routes/system.js`, `services/system-repository.js`, `services/realtime.js`,
`utils/server-logger.js`, `migrations/007_system.proposed.sql`,
`tests/system.test.js`, this document and Phase 8 reports.
Files updated: `app.js`, `server.js`, `config/environment.js`,
`middleware/error-handler.js`, `services/devices.js`, `validators/settings.js`,
`.env.example`, `README.md`, `package.json` and `package-lock.json`.
Dependency added: `socket.io-client` as a development dependency; the existing
`socket.io` runtime dependency is reused.

## Database/deployment boundary

`migrations/007_system.proposed.sql` is **review only**, following proposed
migrations 001–006. Nothing was applied to live Supabase. REST metadata exposed
no tables/RPC definitions; that does not establish that private tables are absent.
Review the complete production schema and collisions before approval/application.

New tables:

| Table | Purpose |
|---|---|
| wp_system_settings | JSON settings sections, revision, update actor/time |
| wp_notifications | Owner-bound system notifications, read time, soft deletion |
| wp_audit_logs | Append-only administrative actor/action/resource/time |
| wp_realtime_events | Transactional event outbox, safe identifiers and metadata |
| wp_device_connectivity | Last observed connectivity for transition detection |

All enable RLS, deny `anon`/`authenticated`, and grant only required server
`service_role` operations. Custom JWTs are not Supabase Auth tokens. RPCs recheck
roles/ownership; Express verifies sessions. Audit/outbox inserts occur in the
same transaction as the originating mutation, so rollbacks do not emit events.
Existing RPC implementations are retained under `*_before_system` names and
wrapped with unchanged argument/response contracts. No production records are
deleted. Audit rows contain no submitted values, passwords, token hashes, or
device credentials. Audit covers employee writes (each bulk target separately),
department writes, device provision/status/removal, category writes, privacy
policy updates, and settings writes. Direct SQL/operator changes are outside
these administrative RPC audit hooks and require database/operator auditing.

## HTTP routes

All paths are under `/api/v1`. Existing health response remains unchanged.

| Method/path | Role | Behavior |
|---|---|---|
| GET /settings | A | All sections and revisions |
| PUT /settings/monitoring | A | Partial monitoring section update |
| GET /settings/working-hours | A, Agent | Authorized weekly policy |
| PUT /settings/working-hours | A | Complete seven-day schedule + IANA timezone |
| PUT /settings/data-retention | A | Retention preference; mandatory consent preserved |
| PUT /settings/notifications | A | Idle/offline/digest preferences |
| GET /settings/roles | A | Role scopes and representative permissions |
| GET /notifications | A, M, E | Own notifications; page/pageSize |
| PATCH /notifications/:id/read | A, M, E | Own notification only |
| PATCH /notifications/read-all | A, M, E | Own notifications only |
| DELETE /notifications/:id | A, M, E | Own notification soft deletion |
| GET /audit-logs | A | Filtered/paginated audit entries |
| GET /audit-logs/export | A | Filtered CSV, maximum 10,000 rows; oversize 413 |
| GET /health | Public | Existing status/uptime contract |
| GET /version | Public | Actual API package version + configured minimum Agent version |
| GET /agent/latest | Registered Agent | Configured HTTPS installer URL, version, size, SHA-256 |

“All” notification users are human A/M/E, consistent with existing profile APIs;
Agent connections are device identities and do not inherit a human inbox.
Missing installer configuration returns **503**, never a guessed URL. Minimum
Agent version is `null` until an explicit compatibility policy is configured.
Release URL may not contain embedded credentials, query strings, or fragments.

Example settings update (actual field names from the existing dashboard):

```json
{"idleMinutes":5,"evaluationSeconds":60,"syncMinutes":5,"offlineDays":7,"trackApplications":true,"trackKeyboardCounts":true,"trackMouseCounts":true,"pauseOutsideHours":true}
```

Allowed values/ranges are centralized in `validators/settings.js`. Unknown
fields are rejected. Working hours require `timezone` and seven ordered entries:

```json
{"timezone":"Asia/Colombo","schedule":[{"day":"Monday","enabled":true,"start":"09:00","end":"17:30"},{"day":"Tuesday","enabled":true,"start":"09:00","end":"17:30"},{"day":"Wednesday","enabled":true,"start":"09:00","end":"17:30"},{"day":"Thursday","enabled":true,"start":"09:00","end":"17:30"},{"day":"Friday","enabled":true,"start":"09:00","end":"17:00"},{"day":"Saturday","enabled":false,"start":"09:00","end":"17:30"},{"day":"Sunday","enabled":false,"start":"09:00","end":"17:30"}]}
```

No schedule/timezone is silently initialized in the database. Existing env-based
Agent policy fields remain for compatibility. Updated `/devices/agent-config`
also returns authoritative `settings`, `syncInterval` and `workingHoursPolicy`.
The full weekly policy supports unequal days/overnight shifts. Legacy clients
that only consume uniform `workingHours.start/end` must be updated separately
before relying on nonuniform schedules; Agent code was intentionally untouched.
Settings delivery does not start tracking, accept consent, override manual stops,
or claim the separate Agent has applied settings. `requireConsent:false` is
rejected. Retention is a stored preference, **not a newly enabled destructive
purge worker**. Weekly digest is a stored preference; no new scheduled email
sender is introduced. Idle/offline in-app alerts use fixed safe text and scope
recipients through current Admin/Manager visibility.

Audit filters: `from`, `to` UTC ISO timestamps, `actorId` UUID, exact `action`,
exact `resource`, `page`, `pageSize` (1–100). Date endpoints are inclusive.
CSV quotes every cell, escapes quotes/newlines and protects formula prefixes.
Oversize exports fail rather than truncate silently.

Typical success response:

```json
{"success":true,"message":"Request completed","data":[],"pagination":{"page":1,"pageSize":25,"total":0}}
```

Phase 8 errors include `success:false`, `message`, `data:null` and legacy
`error.message` after authentication. Earlier routes retain their existing
error contracts. Expected ownership misses return 404 without exposing records.

## Socket.IO contract and security

Socket.IO shares the existing HTTP server at its default `/socket.io` path.
Browser handshake:

```js
const socket = io(apiOrigin, {auth: {token: accessToken}});
```

Registered Agent may supply its existing device JWT with the same `token`
field, or `{deviceId, deviceCredential}`. The latter reuses actual device login,
creates a bounded internal session, and revokes it on disconnect; no credential
is returned in an event. Device credentials must be provisioned/registered through
existing APIs. Human JWTs never become Agent identities. Mixed/unknown handshake
fields and temporary-password accounts are rejected. Tokens do not go in URLs.
No listener receives key contents/window titles/credentials. Raw handshake auth
is cleared after validation. Socket buffers are limited to 16 KiB.

Both polling and WebSocket handshakes enforce exact configured browser Origins;
native clients may omit Origin. Configure HTTPS/WSS at the deployment TLS proxy
or HTTPS server: local development HTTP is **not encrypted**. CORS is not a
substitute for JWT/device authentication. The same comma-separated `CORS_ORIGIN`
list governs Express and sockets. Apply network rate limits at the deployment
proxy in addition to existing HTTP auth limits.

Only server-owned `user:<id>`/`device:<id>` rooms are joined. Client `join`
requests receive a forbidden acknowledgement. Every delivery re-authenticates
the JWT/session and rechecks current database visibility; revoked sessions and
disabled/removed devices disconnect. A periodic check catches revocation even
without events (default maximum 10 seconds, plus in-flight request latency).
Clients must reconnect with refreshed valid credentials after access expiry.

| Event | Source and payload | Authorized recipients |
|---|---|---|
| employee:status | Committed status ID/status/time, or effective connectivity status | A; M within current scope |
| dashboard:stats | Fresh existing analytics query: total/active/idle/paused/offline/unknown | A; current scoped M |
| activity:update | Committed interval identifiers only | A; current scoped M |
| device:online | Registered/active device becomes online from heartbeat evidence | A; current scoped M |
| device:offline | Timeout/disable/removal/user disable transition | A; current scoped M |
| notification:new | Newly stored notification ID/type/safe message/time | Owning human user only |
| settings:updated | Changed section + revision; fetch authorized current config | Valid registered Agents |

Presence uses `DEVICE_OFFLINE_TIMEOUT_SECONDS`, shared with existing analytics;
no socket connection itself proves employee activity. Paused stays separate from
Idle. A short-lived online/offline transition wholly between sweeps may not be
observed; status uploads themselves are still persisted. Status events refer to
the device; dashboards should fetch the scoped live-status endpoint to reconcile
employees with multiple devices. Stats are recomputed for the recipient's scope,
never an organization-wide value sent to a Manager. No productivity formula was
added; `productivity_score` remains unavailable.

Outbox polling defaults to 2 seconds and reads at most 200 events per pass.
Transaction advisory locks serialize event sequence allocation with commits;
connectivity sweeps serialize across API instances. Each API instance reads the
shared outbox and delivers only to its locally connected sockets (no Redis
adapter required for these server-originated individual deliveries). Each starts
at the current tail to avoid replaying stale events as live activity. Sockets
are live hints, **not guaranteed exactly-once delivery**; reconnects fetch HTTP
snapshots. A retry after partial delivery may repeat an event. No independent
client acknowledgement/replay protocol is claimed. Existing SQL aggregation and
bounded batches are reused; event fan-out rechecks cost database calls per
recipient, so load-test the intended deployment size before scaling. Outbox
archival/retention requires a separately reviewed operational policy; this phase
does not automatically delete stored history.

## Configuration and operation

In `.env`, configure exact `CORS_ORIGIN` values. After schema approval and actual
application, set `REALTIME_WORKER_ENABLED=true`. Until then the worker defaults
off and no presence/outbox sweeps run against the configured project. Socket
authentication and periodic session revocation checks remain available.
`REALTIME_POLL_MS` range 250–60000; `SOCKET_REVALIDATE_MS` range 250–60000.
Release fields are `AGENT_MIN_VERSION`, `AGENT_LATEST_VERSION`,
`AGENT_INSTALLER_URL`, `AGENT_INSTALLER_SHA256`, `AGENT_INSTALLER_BYTES`.

Centralized errors hide raw database/SMTP/exception text. Development provides
safe diagnostic type/status and allowlisted network error codes in server logs;
production has generic unexpected-error responses. Morgan logs route templates
instead of submitted paths/queries/headers/bodies. Fatal unhandled failures log
safe structured metadata and exit rather than continue in an unknown state.
Graceful SIGINT/SIGTERM stops workers, pending polls, Socket.IO and HTTP.

## Verification

`npm test` runs all regression and Phase 8 tests. Phase 8 uses actual local HTTP,
Socket.IO clients, JWT services and PostgreSQL/PGlite transactions with synthetic
records, applying proposed SQL only to an isolated in-memory database. It checks
roles, owner scope, persistence, settings validation, no-op/rollback behavior,
audit/CSV, TLS-release configuration validation, invalid Origin/token, forbidden
join, device auth, event routing, scoped stats, heartbeat transitions, session
revocation, disabled devices, RLS and safe failure/logging. Production Supabase
migration, deployment TLS/proxy, real installer hosting and frontend/Agent live
integration remain **NOT TESTED**. See `reports/phase8-results.json` for final run.
