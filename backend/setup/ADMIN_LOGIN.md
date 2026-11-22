# First Admin login: empty Supabase project

This application uses **custom WorkPulse authentication**, not Supabase Auth.
The Admin email/password belong to a WorkPulse user, not to the database
connection. Do not add a Supabase Auth user and expect it to log into this app.
Never send your password or Supabase secret in chat.

## 1. Review and create the minimal authentication schema

Use your intended Supabase project, SQL Editor → New Query. First run
`setup/admin-preflight.sql` (read-only). If it lists existing WorkPulse objects,
stop and reconcile those objects; do not drop tables or rerun CREATE blindly.
Supabase's own internal schemas are normal and should not be changed.

For an empty WorkPulse schema, review the **complete** existing file:
`migrations/001_auth.proposed.sql`. Paste the entire file, including BEGIN and
COMMIT, into the SQL Editor and run it only after approving the migration.
This is the existing canonical migration; no second users schema or copy has
been invented. It creates these six tables, indexes, atomic auth functions,
server-only grants and RLS browser-deny policies:

| Table | Purpose |
|---|---|
| wp_auth_users | Email, bcrypt password hash, trusted A/M/E role |
| wp_auth_devices | Device ownership and hashed device credential |
| wp_auth_sessions | Session expiry and revocation |
| wp_auth_refresh_tokens | Hashed, rotating refresh tokens |
| wp_auth_password_resets | Hashed single-use recovery tokens |
| wp_auth_manager_assignments | Manager employee scope |

Migration 001 alone is sufficient for initial custom Admin login, `/auth/me`
and logout with the current implementation. It does not populate demo data.
The remaining management/analytics/settings APIs require proposals 002–007,
reviewed and applied in order later. Keep DAILY_SUMMARY_WORKER_ENABLED and
REALTIME_WORKER_ENABLED false until their schema/policy dependencies are deployed.
This setup does not automatically apply any migration.

## 2. Confirm private backend configuration

In backend/.env retain the actual SUPABASE_URL and SUPABASE_SECRET_KEY for this
same project, and one valid signing secret under JWT_SECRET or AUTH_JWT_SECRET.
The server key must be an sb_secret_ key or legacy service_role key, never a
publishable/anon key. Do not change PORT=5000. SMTP is not required for this
trusted first-account bootstrap; password recovery email is a separate setup.

## 3. Create your first real Admin account

Open your own interactive PowerShell terminal:

```powershell
cd C:\Users\DELL\Documents\GitHub\WorkPulse\backend
npm run bootstrap:admin
```

The existing trusted operator script asks for your Admin email, password and
confirmation. Password input is hidden. Use at least 12 characters containing
uppercase, lowercase, a number and a symbol (maximum 72 UTF-8 bytes).

The script bcrypt-hashes your password before sending it to the existing
`wp_auth_bootstrap_admin` RPC. It creates one active role-A user with
must_change_password=false. There is no default password, plaintext SQL password
or public Admin registration endpoint. The RPC only succeeds while
wp_auth_users is empty; it refuses a second bootstrap without modifying existing
users. Do not delete existing users to force it to run again.

Expected message: `Initial administrator created`.

Optional safe SQL verification (no password/token fields):

```sql
select id, email, role, is_active, must_change_password
from public.wp_auth_users
where role = 'A';
```

## 4. Start and sign in

Backend terminal: `npm run dev` in backend. Frontend terminal: `npm run dev` in
Frontend. If an existing dev process is already running, reuse it; do not start
a second process on the same port. Open the frontend's printed URL: it redirects
to /login. Use the email/password entered above. The UI calls POST
/api/v1/auth/login and verifies role A through GET /api/v1/auth/me before opening
the dashboard. No operational demo records are created, so empty dashboard data
is expected. Frontend data integration is separate from initial login.

## If setup fails

* Missing table/function or storage-unavailable response: confirm migration 001
  completed in the same project as backend/.env. If PostgREST reports a missing
  object after successful creation, refresh its schema cache using Supabase's
  documented workflow; do not disable RLS or grant browsers access.
* Bootstrap refused: check whether any wp_auth_users row already exists. The
  one-time protection is intentional; do not overwrite credentials.
* Wrong password format or mismatched confirmation: rerun the interactive script
  with a valid matching password. Do not paste credentials into a command line.
* Role is not A: an Employee/Manager account cannot enter the Admin dashboard.
* Only a Supabase Auth user exists: this custom app still needs its WorkPulse
  bootstrap user; the two identity systems are separate.

Verification: the existing auth tests apply **only migration 001** to isolated
PostgreSQL/PGlite and verify first Admin bootstrap/login and second-bootstrap
refusal. This proves the minimal dependency path, not successful live deployment.
No live schema or real Admin account was created by preparing this guide.
