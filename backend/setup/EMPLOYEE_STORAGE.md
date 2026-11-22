# Employee storage and UI integration

Employee creation uses the existing custom authentication architecture. It does not create a Supabase Auth user or a separate table for each employee.

## Existing database dependencies

| Object | Purpose |
| --- | --- |
| `wp_auth_users` | Internal user UUID, unique email, bcrypt password hash, trusted role, account status and temporary-password metadata. |
| `wp_employee_profiles` | One row per user: `user_id` references the authentication user; employee code, first/last name, phone and department assignment. |
| `wp_departments` | Existing departments; profile `department_id` references the department UUID and may be null. |
| `wp_auth_devices` | Existing employee-device relationships used to derive agent installation state. No device is created by the employee form. |
| `wp_core_employee_write` | Admin-authorized transactional employee create/update/status/reassignment operations. |
| `wp_core_employees_read`, `wp_core_employee_summary` | Permission-scoped directory, filters, pagination and summary counts. |
| `wp_core_departments_read` | Permission-scoped department options. |

The authoritative SQL is in [001_auth.proposed.sql](../migrations/001_auth.proposed.sql) and [002_core_management.proposed.sql](../migrations/002_core_management.proposed.sql). It includes the existing profile-initialization trigger, foreign keys, unique constraints, indexes, RLS and restricted server-function access. Do not create duplicate tables or expose the service key to the frontend.

During this implementation the required table columns and management RPC paths were confirmed through read-only Supabase metadata. No migration, real employee insert or production-data update was executed. A different environment must deploy the reviewed existing migrations before these APIs can work; review the SQL and existing schema before applying anything.

## Save flow

1. An authenticated Admin opens Employees and loads server records, summary counts and department options.
2. Add Employee submits the supported fields to `POST /api/v1/employees` with the Admin bearer token. The displayed employee code is separate from the internal UUID.
3. The existing validator and employee service validate fields and hash the temporary password with bcrypt. No plaintext password is stored in the database or browser storage.
4. The existing RPC creates the authentication user and linked personal-information row in one transaction. Duplicate email/code or an invalid department prevents a partial account from being left behind.
5. The response contains safe employee fields. The UI waits for acknowledgement, then refetches the saved record. On failure it keeps the form open and displays an error.

New accounts are active with a mandatory first-login password change. Deactivate/reactivate uses the directory actions. The backend represents managers through departments; the form does not submit a fictional per-employee manager field. Account notification email delivery remains subject to configured SMTP credentials and sender verification.

## Configuration and verification

Backend environment configuration remains centralized: `SUPABASE_URL`, the server-only `SUPABASE_SECRET_KEY`, and `AUTH_JWT_SECRET` (or the existing supported `JWT_SECRET`). Keep actual values only in the ignored backend environment file. The development frontend proxies `/api/v1` to the backend on port 5000. For deployment use the real API proxy or `VITE_API_BASE_URL`; never put a Supabase service key or JWT signing secret in Vite variables.

Run `node --test tests/core.test.js` from the backend for isolated PostgreSQL integration tests. They verify account/profile creation, bcrypt comparison, temporary-password handling, duplicate rollback, authorization and the existing management APIs. Frontend unit/browser tests separately verify API mapping and the employee form lifecycle using synthetic HTTP fixtures. Live metadata availability is not a claim that a real employee was created during verification.
