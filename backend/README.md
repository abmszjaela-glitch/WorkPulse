# WorkPulse backend authentication

Phase 2 implements custom authentication using bcrypt and WorkPulse-issued JWTs.
Supabase is the database transport only: Supabase Auth login, refresh and recovery
tokens are not accepted or issued by this implementation. Frontend and agent code
are unchanged. All modules use ES imports and exports.

## Deployment status and schema proposal

The configured Supabase REST OpenAPI endpoint returned HTTP 200 with only `/`
and no table definitions or RPCs. This does not prove that private schemas are
empty. No existing user, employee, role, device or session schema could be verified.
The supplied **WorkPulse API Endpoints.docx** defines endpoint responsibilities
and roles but does not define JSON fields or the device-enrollment bootstrap flow.
The request/response contract below is an explicit integration design.

`migrations/001_auth.proposed.sql` is a reviewable proposal, NOT automatically
applied. It creates these explicitly new tables:

- `wp_auth_users`: custom user identity, bcrypt hash, trusted A/M/E role, active
  state, credential version and temporary-password expiry.
- `wp_auth_devices`: employee binding and SHA-256 device credential hash.
- `wp_auth_sessions`: durable session binding, expiry, credential version and revocation.
- `wp_auth_refresh_tokens`: hashed single-use refresh tokens and consumption state.
- `wp_auth_password_resets`: hashed expiring single-use reset tokens.
- `wp_auth_manager_assignments`: explicit manager-to-employee visibility scope.

Complete column inventory (all are proposed, not asserted existing columns):

| Table | Columns |
| --- | --- |
| `wp_auth_users` | `id`, `email`, `password_hash`, `role`, `is_active`, `auth_version`, `must_change_password`, `temporary_expires_at`, `created_at` |
| `wp_auth_devices` | `id`, `user_id`, `credential_hash`, `is_active`, `created_at` |
| `wp_auth_sessions` | `id`, `user_id`, `device_id`, `auth_version`, `expires_at`, `revoked_at`, `created_at` |
| `wp_auth_refresh_tokens` | `token_hash`, `session_id`, `expires_at`, `used_at` |
| `wp_auth_password_resets` | `token_hash`, `user_id`, `expires_at`, `used_at`, `created_at` |
| `wp_auth_manager_assignments` | `manager_id`, `employee_id` |

UUID primary keys identify users, devices and sessions. Token hashes are primary
keys; emails and device credential hashes are unique. Role check constraints
allow A/M/E only, email values must be normalized, password hashes must use a
bcrypt prefix, hash lengths are constrained, temporary credentials require an
expiry, and a manager cannot assign themselves. Foreign keys bind devices and
sessions to users, refresh tokens to sessions, reset tokens to users, and manager
assignments to both identities. No cascading production deletion is configured.
Additional indexes cover device owners, session owners/devices, refresh session
lookups and reset user lookups. The manager/employee composite primary key indexes
manager scope queries; unique constraints provide email/hash lookup indexes.

The transaction deliberately uses `CREATE`, not `CREATE IF NOT EXISTS`: a conflicting
table or function aborts rather than silently accepting a different schema. The
test suite verifies this refusal preserves existing test data. Absence of duplicate
business entities in inaccessible private schemas cannot be established without
the full schema review; do not apply until that review and explicit approval.

These are authentication identities, not invented employee business records or
department columns. Review the complete SQL schema first and map existing
employee IDs before deployment if such records already exist. Replace the manager
assignment adapter with the reviewed department relationship when available.

RPCs perform atomic session creation, refresh rotation/replay revocation, password
changes and reset consumption. Tables have RLS enabled, explicit browser-deny policies, and
no `anon`/`authenticated` grants. Only `service_role` may use the tables/RPCs;
functions are security invoker with an empty search path and qualified tables.
Do not grant direct client access. WorkPulse JWTs are never sent to Supabase.

## Configuration and activation

1. Review the proposed migration against the full schema; apply it manually through
   your authorized migration workflow. No live schema writes were performed here.
2. Configure `.env` from `.env.example`. Preserve the existing Supabase URL and
   server-only secret. Authentication requires `SUPABASE_SECRET_KEY`; the public
   key fallback used by the base configuration is insufficient for auth storage.
3. Set `AUTH_JWT_SECRET` to a securely generated random secret of at least 32 bytes.
   Never reuse a Supabase API key or commit the value. No default secret exists.
4. Configure Resend SMTP using `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`,
   `SMTP_SECURE=true`, `SMTP_USER=resend`, and `SMTP_PASS` set to a Resend API key.
   Set `SMTP_FROM` to a sender on your verified domain and `PASSWORD_RESET_URL` to
   the actual HTTPS frontend reset page. No production frontend URL is assumed. The page
   must extract the token from the URL fragment and submit it in the POST body.
   No frontend recovery page was created in this backend-only phase.
5. For a new, empty auth database only, run `node scripts/bootstrap-admin.js` in an
   interactive trusted terminal. Password entry is hidden; no default account,
   public registration or HTTP bootstrap endpoint exists. The database transaction
   refuses bootstrap if any auth account already exists. Treat the Supabase secret
   and bootstrap access as privileged operator credentials.
6. Start with `npm start`, or use `npm run dev` locally.

Missing signing configuration returns 503 for auth while health remains available.
Missing migration/storage returns a safe 503, never a mock user or success. Signing
secret rotation invalidates existing JWTs; revoke sessions if rotating after a
compromise. A normal logout revokes one session; password changes/resets revoke all.

## API contract

All endpoints are under `/api/v1/auth`, return JSON errors as
`{"error":{"message":"..."}}`, and set `Cache-Control: no-store`.

| Method and path | Input | Result |
| --- | --- | --- |
| POST `/login` | `{email,password}` | Access JWT, opaque refresh token and safe user |
| POST `/logout` | Bearer access JWT | 204; access and refresh invalidated |
| POST `/refresh` | `{refreshToken}`; no access JWT required | Rotated access/refresh pair |
| GET `/me` | Bearer access JWT | `{user}` and device context for device sessions |
| POST `/forgot-password` | `{email}` | Generic 200 recovery message; 503 if SMTP configuration absent |
| POST `/reset-password` | `{token,newPassword}` | 204; token consumed, all sessions revoked |
| PUT `/change-password` | Bearer human JWT and `{currentPassword,newPassword}` | 204; all sessions revoked |

Login/refresh response:

```json
{
  "accessToken": "<JWT>",
  "refreshToken": "<opaque token>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {"id": "<UUID>", "email": "<email>", "role": "E", "mustChangePassword": false}
}
```

Transport tokens over HTTPS. Client integrations must use secure token storage
(desktop Credential Manager; dashboard design must avoid insecure persistent
browser storage). This phase uses explicit body/Bearer tokens, not cookies; no
cookie-based refresh or CSRF integration is silently introduced.

## Authorization and devices

`authenticate(service)` verifies algorithm, signature, expiration, issuer,
audience, token purpose and durable session/user/device state, then creates
`req.auth`. User roles are read from current server storage, not request input.
`authorize(...roles)` enforces route roles; `authorizeEmployee(service)` enforces
own-account or explicit manager scope. Routes handling future employee/department
queries must compose both checks as appropriate. An Admin manages employees and
departments; a Manager has scoped read access; an Employee has self access.

`registerEmployee(req.auth, details)` is an internal Admin-only service; role
defaults to E. Only an authenticated Admin may deliberately assign A or M. A
database uniqueness constraint prevents duplicate emails, including concurrent
inserts. Public `/register` is not implemented. Temporary passwords are supported
with `temporary: true`; they expire and restrict users to password change, me,
logout and refresh until changed. New passwords require 12 characters, upper and
lowercase letters, a digit and a symbol; values over bcrypt's 72-byte limit fail.

`provisionDevice(adminContext,userId)` creates a random one-time-returned device
credential, storing only its SHA-256 hash. `loginDevice(deviceId,credential)` is
an internal exchange issuing a device-bound JWT with audience `workpulse-agent`
and role Agent. A human login always issues a human token, including when used on
the desktop. It never grants activity-upload privileges. Disabled devices or users
fail immediately. Password management requires human credentials, not a device JWT.

Phase 2 did not expose device endpoints. Phase 3 implements the documented routes
using the trusted provisioning design in [Core APIs](CORE_APIS.md). Human login
still cannot grant unrestricted Agent access through a public route.

## Security and operational limits

Refresh tokens and recovery tokens use 256-bit randomness and SHA-256 hashes in
storage; only password hashes use bcrypt. Refresh rotation is atomic; reusing a
consumed refresh token revokes its session family, so clients must serialize
refreshes. Every protected request checks durable state for immediate logout and
deactivation. Sessions have a fixed absolute refresh lifetime.

Credentials, raw tokens, hashes, request bodies and query strings are not logged.
Responses are explicitly allowlisted. Login failures are generic and unknown
users perform a dummy bcrypt comparison. Recovery messages do not reveal account
existence; known-recipient SMTP latency can still differ. Use an audited durable
mail queue if timing indistinguishability is required; no delivery success is
claimed or reset token returned by the API. SMTP failure emits a fixed safe log.

Auth rate limits are per IP and process: 20 credential requests, 5 recovery requests,
60 refreshes per 15 minutes. Do not blindly trust proxy headers. Before multiple
replicas, configure a shared rate-limit store and explicitly trusted proxy network.
Deploy TLS at the trusted gateway. Retain consumed refresh hashes for the session
lifetime for replay detection; periodically purge expired sessions and their
tokens and expired/consumed reset records according to a reviewed retention job.
No scheduler or irreversible retention deletion is introduced by this phase.

## Email delivery prerequisites

`services/email-service.js` shares one configurable SMTP transport for reset links,
account-created notifications and password-changed notifications. There is no SMS
code or fallback. Notification failures do not undo committed account/password
changes; they emit a fixed safe log. Passwords and credentials are never emailed.

Configure these values before live email testing:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=
SMTP_FROM=
PASSWORD_RESET_URL=
```

Add an owned sending domain/subdomain in Resend, publish the exact DNS verification
records shown by Resend (SPF and DKIM), and wait for verified status. Configure
DMARC according to your domain policy. Choose `SMTP_FROM` on that verified domain,
create a sending API key, and store it in `SMTP_PASS`. Keep open/click tracking off
for password-reset messages. See the official [SMTP setup](https://resend.com/docs/send-with-smtp)
and [domain guide](https://resend.com/docs/dashboard/domains/introduction).
The provider remains configurable through SMTP variables. No email delivery or
domain verification is claimed until configured and tested with an authorized recipient.

## Verification

Latest combined run before Phase 5: **82 passed, 0 failed**. Configured-backend health and 404 checks
passed; authentication correctly returned 503 with no signing secret configured.
Production dependency audit reported 0 vulnerabilities. The development-only
Nodemon/minimatch chain has 2 moderate advisories; no forced dependency downgrade
was applied. SMTP delivery and the live database migration remain **NOT TESTED**.

Run `npm test`. Tests apply the exact proposed SQL to isolated in-memory PostgreSQL
(PGlite), exercise the production repository through a test-only Supabase-shaped
adapter, and test Express routes over real local HTTP. Only synthetic identities
are created; the configured live database is never mutated. Transaction replay
and concurrent-promise tests are included; multi-process load testing remains a
deployment check. Live migration, real employee credentials, real SMTP delivery
and client integration are not tested until deployment prerequisites are supplied.

See [Phase 3 APIs and completion report](CORE_APIS.md) and
[machine-readable results](reports/phase3-results.json). Live activation and
department productivity remain pending as documented there.

See [Phase 4 agent data APIs and compatibility report](AGENT_DATA_APIS.md),
[observed local HTTP examples](reports/phase4-http-examples.json) and
[Phase 4 verification results](reports/phase4-results.json). The agent's existing
queue envelope is supported; its missing network/auth integration is not silently
implemented or claimed working.

See [Phase 5 validation, categories and daily processing](PROCESSING.md). Productivity
scores remain null under the confirmed temporary business rule. The proposed 004
migration is not applied and the summary worker defaults to disabled.

See [Phase 6 dashboard and analytics APIs](ANALYTICS.md),
[observed analytics HTTP examples](reports/phase6-http-examples.json) and
[proposed analytics migration](migrations/005_analytics.proposed.sql).

See [Phase 7 reporting and exports](REPORTING.md), including scoped report APIs,
CSV/PDF downloads, export history, synthetic samples and pending deployment requirements.
## Phase 8 system and real-time APIs

See [SYSTEM_APIS.md](SYSTEM_APIS.md) for endpoints, Socket.IO authentication,
event scoping, proposed migration 007 and deployment requirements. Verification:
[reports/phase8-results.json](reports/phase8-results.json). No live schema changes
are applied by application startup. Real-time database sweeping is opt-in after
migration review/application; frontend and Agent sources are unchanged.

