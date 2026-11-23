# WorkPulse Postman verification

Import `WorkPulse.postman_collection.json` (99 document requests + 4 role checks)
and `WorkPulse.postman_environment.json`. `baseUrl` includes `/api/v1`.
Credentials/tokens are deliberately blank. Supply only local test credentials in
your private environment; never export populated environments to Git.

Use an isolated database with explicitly approved/applied migrations 001–007.
The collection includes account deactivation, deletion, password changes and
logout-all: **do not run the entire collection against production**. Requests
need valid disposable employee/department/device/notification/category IDs.
Assign adminToken/managerToken/employeeToken/agentToken from actual corresponding
sessions. Login returns `accessToken` and `refreshToken`; save them privately.
Normal employee login does not issue unrestricted Agent credentials. Register
with a pre-provisioned device identity/token and one-time deviceCredential, then
replace agentToken/deviceCredential with the registration response. Device
provisioning is an existing trusted server/operator service, not a public route.

Set `loginEmail`, `loginPassword`, `newPassword`, `newEmployeeEmail` and IDs before
running selected requests. Strong passwords need >=12 characters with uppercase,
lowercase, number and special character, within bcrypt's 72-byte limit. Use a
real small PNG/JPEG base64 payload for avatarBase64. Consent policy version in
the example must match the actual active policy. All aggregate upload examples
reuse the Agent's real offline-record envelope; prerequest scripts generate fresh
UUIDs and recent one-minute intervals. For intentional duplicate-upload testing,
disable that script and repeat exactly the same record/id, then alter a duration
to verify conflict handling. Batch bodies are arrays, not `{records: [...]}`.

Common list filters: `page=1&pageSize=25`. Employee list also supports `search`,
`departmentId`, `role=A|M|E`, `status=active|inactive`. Analytics/reports accept
`from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Asia/Colombo`; eligible endpoints also
accept `departmentId`/`employeeId` and `reportType=summary|activity|application-usage`
(see ANALYTICS.md/REPORTING.md). Audit filters use timezone-aware ISO timestamps,
`actorId`, `action`, `resource`. Use only documented endpoint-specific filters:
unknown query fields intentionally fail 400.

Each request has basic safe-response tests. RBAC examples exercise GET /settings
as each role (Admin 200, others 403). Also remove Bearer auth (401), use a tampered
token (401), use a Manager outside employee/department scope (404), submit invalid
UUID/unknown fields (400), and repeat management create with duplicate email/name
(409). Do not interpret a 4xx as a successful functional test: inspect expected
status for the selected scenario. SMTP-dependent recovery and unconfigured
installer information can return 503 until deployment configuration is supplied.
No automatic token-capture script overwrites role tokens accidentally.

Saved responses include explicit expected unauthorized contracts and observed
sanitized local analytics responses where applicable. They are example fixtures,
not deployed employee statistics. CSV/PDF requests return binary/text attachments;
save and inspect them separately. Existing automated tests validate CSV escaping,
PDF signature/multipage output and authorization.

Socket.IO is not a regular HTTP request in this collection. Use a Socket.IO
client with `auth: {token: ...}` against the API origin; see SYSTEM_APIS.md.
Real socket integration tests run via `npm test`.

Regenerate with `node scripts/generate-postman.js`. The source inventory is
`reports/api-document-manifest.json`, extracted from the supplied API document.
