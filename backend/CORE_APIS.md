# WorkPulse core management APIs

Backend code and isolated integration tests are prepared for Phase 3. Live activation
is pending explicit schema approval and configuration. Department productivity
calculation is unavailable until an approved activity source and definition exist;
its authenticated, scoped route returns 503 instead of invented metrics.
No live database data, frontend files or desktop agent files were changed.

## Database inspection and proposed migration

On 2026-11-20 the configured Supabase OpenAPI endpoint returned HTTP 200 with only
`/` and no exposed tables/RPCs. This does not prove private schemas are empty. The
only project migration was the unapproved Phase 2 proposal. The full private schema
still needs review before activation; the new code does not assume these tables
already exist in production.

Review [002_core_management.proposed.sql](migrations/002_core_management.proposed.sql)
after [001_auth.proposed.sql](migrations/001_auth.proposed.sql). Neither was applied.
Explicit approval is required before live execution. Colliding names cause rollback,
not silent reuse or replacement.

| Object | Proposed changes |
| --- | --- |
| `wp_auth_users` | Reuse identity, email, password hash, role, active state and credential version; add `deleted_at` |
| `wp_auth_devices` | Reuse identity/owner/credential hash; add `name`, `platform`, `registered_at`, `last_seen`, `deleted_at` |
| `wp_departments` | `id`, `name`, `description`, `manager_id`, `is_active`, `deleted_at`, `created_at` |
| `wp_employee_profiles` | `user_id`, unique `employee_code`, `first_name`, `last_name`, `phone`, `department_id`, `language`, `timezone`, bounded `avatar_base64`, three boolean notification preferences |
| `wp_privacy_policies` | Immutable `version`, `content`, `is_current`, `created_by`, `created_at` |
| `wp_consent_receipts` | Composite `(user_id,policy_version)`, optional `device_id`, database `accepted_at` |

Foreign keys bind managers, employees, departments, policies and receipts. Live
department names are case-insensitively unique; employee codes are unique. Length,
role, version and image limits are constrained. Indexes cover manager/department
lookups and receipt versions; a partial unique index allows one current policy.
The migration backfills profiles for approved existing auth identities and adds an
insert trigger for subsequent accounts without copying or changing passwords.

New tables use RLS with explicit browser-deny policies. Tables, safe views and
security-invoker RPCs are backend-service-role-only. Database functions recheck actor
role/scope; custom JWTs are verified by Express and never used as Supabase Auth
tokens. Password/device hashes and tokens are excluded from management views.
No telemetry tables, public storage bucket or invented productivity columns are added.

Employees, departments and devices are soft-deleted. Department reassignment and
deletion are atomic; missing replacement or batch members cause rollback. Core
mutations serialize invariant checks. Admin self-deactivation/deletion and removal
of the last active Admin are blocked. Disabled/deleted identities and devices lose
session access immediately. Historical policies, receipts and sessions remain stored.

## Endpoint and role inventory

All paths use `/api/v1`. Profile `All` means human A/M/E; device contexts have only
the explicitly documented Agent capabilities.

| Endpoints | Roles |
| --- | --- |
| GET `/employees`, `/employees/:id`, `/employees/summary`, `/employees/export` | A, scoped M |
| POST `/employees`; PUT `/employees/:id`; PATCH `/employees/:id/status`, `/employees/:id/department`; POST `/employees/bulk-deactivate`, `/employees/:id/reset-password`; DELETE `/employees/:id` | A |
| GET `/departments`, `/departments/:id`, `/departments/:id/employees`, `/departments/:id/productivity` | A, scoped M |
| POST `/departments`; PUT/DELETE `/departments/:id`; GET `/departments/export` | A |
| GET `/devices`, `/devices/:id` | A, scoped M |
| PATCH `/devices/:id/status`; DELETE `/devices/:id` | A |
| POST `/devices/register`, `/devices/heartbeat`; GET `/devices/agent-config` | Agent |
| GET/PUT `/profile`; POST `/profile/avatar`; GET `/profile/login-history`; GET/PUT `/profile/notification-preferences`; POST `/profile/logout-all` | Own A/M/E identity |
| GET `/consent/policy` | A, M, E, Agent |
| POST `/consent/accept` | E, Agent (own employee identity) |
| GET `/consent/status/:employeeId`; PUT `/consent/policy` | A |

Manager scope includes self, explicit employee assignments and employees in managed
departments. Lists, counts, individual reads and CSV use the same scope. Hidden
records return 404. Profile writes reject identity, email, role and department fields.

## Request and response contract

The source endpoint document specifies methods/roles/responsibilities, not JSON
fields or upload formats. These are explicit integration contracts. Unknown fields,
bad UUIDs, wrong value types, invalid pagination and empty updates return 400.

- Lists: `page=1`, `pageSize=20` (maximum 100), returning
  `{items,total,page,pageSize}` ordered by creation/UUID. Employee filters:
  `search`, `departmentId`, `role=A|M|E`, `status=active|inactive`. Departments:
  `search`, `status`. Devices: `employeeId`, `status`. Search is literal text.
- Employee POST: required `firstName`, `lastName`, `email`, `password`; optional
  `phone`, `employeeCode`, `role` (E), `departmentId`, `temporary` (true).
  Creation is atomic across identity/profile. PUT accepts editable fields except
  password/temporary. Status PATCH: `{active:boolean}`. Department PATCH:
  `{departmentId:UUID|null}`. Bulk: `{ids:[UUID,...]}`, 1–100 distinct identities.
- Admin password reset returns `{temporaryPassword,expiresAt,mustChangePassword:true}`
  once over HTTPS/no-store. Only a bcrypt hash persists. Existing sessions/reset
  links are invalidated; first login requires password change. No password is logged
  or emailed. Self password changes use the existing auth endpoint.
- Department POST/PUT: `name`, `description`, `managerId` (active A/M or null),
  `active`; POST requires name. DELETE optionally accepts
  `{reassignToDepartmentId:UUID}` and refuses current employees without reassignment.
- CSV is scoped, quoted, UTF-8 and spreadsheet-formula-safe. One database snapshot
  returns all filtered rows up to 10,000; larger exports return 413, never truncate.
- PUT profile: `firstName`, `lastName`, `phone`, `language`, `timezone` (IANA).
  Notification fields: `emailDailySummary`, `idleAlerts`, `emailWeeklyReport`.
  Preferences persist; no delivery scheduler is claimed. Login history reuses actual
  session timestamps/device bindings without inventing browser/IP information.
  Logout-all revokes both human and device sessions.
- Avatar POST: `{imageBase64:"<PNG/JPEG base64>"}` JSON. Maximum 256 KiB/4 million
  pixels, magic-byte and decoded format checks, metadata removal and resizing to
  bounded PNG via Sharp. The sanitized avatar belongs only to the caller and is
  returned as a data URL by their profile. No arbitrary file paths/URLs are accepted.
- Policy PUT: `{content}` creates the next immutable integer version. No sample
  production policy is seeded; unconfigured GET returns 404. Consent POST:
  `{policyVersion}` must match current policy. Caller identity comes from auth;
  repeated acceptance preserves its timestamp. A new version requires new consent.

## Device enrollment and configuration

The document requires Agent-only registration. Initial enrollment therefore uses
trusted internal `auth.provisionDevice(adminContext,employeeId)` followed by
`auth.loginDevice(deviceId,credential)`. There is no public employee-JWT exchange
or Admin/Employee bypass of Agent endpoints. Secure operator delivery/enrollment
remains a deployment prerequisite; no enrollment UI was invented.

POST `/devices/register` requires a valid device JWT plus
`{name,platform,deviceCredential}` proving possession of the current provisioned
secret. Owner/device IDs cannot come from the body. One atomic transaction registers
the device, rotates its credential, revokes old sessions and creates a refresh
session. The response returns safe `device`, one-time `deviceCredential`,
`accessToken`, `refreshToken`, `tokenType`, `expiresIn`. A stolen JWT alone cannot
mint a long-lived device credential. Store returned secrets in secure OS storage.
Lost rotation responses require trusted recovery/re-provisioning, not blind retries.

Heartbeat accepts no identity or timestamp and stores server `last_seen`: device
liveness is not employee activity. Agent config includes threshold/interval, IANA
timezone, ISO weekdays/start/end, current consent status/version and requirements
to honor consent/manual stop. It never starts tracking. The client must enforce
its visible authorization and working-hours controls. Defaults/overrides live in
`config/agent-policy.js` and `.env.example`, preserving configurable timezone/DST rules.

## Files and verification

HTTP handling is separated into `employee-controller.js`, `department-controller.js`,
`device-controller.js`, `profile-controller.js` and `consent-controller.js` under
`controllers/`, alongside the existing `auth-controller.js`. Routes declare paths,
authorization and validation; controllers handle HTTP responses; services handle
operations and repositories handle database access. Consent uses `services/consent.js`
so its controller does not call a repository directly. Controller factories receive
services explicitly and remain compatible with the existing integration test setup.

Added: `config/agent-policy.js`, `config/core-runtime.js`, `middleware/core-validation.js`,
`routes/core.js`, `services/core-repository.js`, `services/employees.js`,
`services/departments.js`, `services/devices.js`, `services/profile.js`, `utils/csv.js`,
`migrations/002_core_management.proposed.sql`, `tests/core.test.js`, this report and
`reports/phase3-results.json`.

Modified: `app.js` (mount routers), `services/auth-service.js` (reject deleted records),
`tests/postgres-client.js` (SQL error/null handling), `.env.example`, `README.md`,
`package.json`, `package-lock.json`. Sharp is the only new runtime dependency.

`npm test`: **58 PASS, 0 FAIL**: 29 new management tests plus 29 existing auth/email
tests. The exact proposed SQL runs in isolated PostgreSQL (PGlite) under service-role
permissions with real HTTP requests through production routers/repositories. All
37 endpoints have authentication and full denied-role coverage. Tests include
successful management operations, missing/duplicate records, validation, database
failures, pagination, scoped CSV, RLS, soft deletion, atomic reassignment, credential
rotation, consent versions, image sanitization and logout-all. The productivity
route's expected 503 is a tested limitation, not successful analytics.

Configured backend health/404 checks passed. Management correctly returns 503
without `AUTH_JWT_SECRET`. Production audit reports 0 known vulnerabilities;
2 existing moderate advisories remain in development Nodemon/minimatch dependencies.

Pending: full private-schema review and explicit migration approval, auth/SMTP
configuration, trusted device provisioning, approved productivity telemetry and
client integration. Live management writes, real SMTP delivery and multi-process
load/concurrency testing remain NOT TESTED. No migration, email, frontend or agent
change was performed to bypass these prerequisites.
