# WorkPulse frontend

React, React Router, Tailwind CSS v4, Lucide and Recharts power the existing dashboard. Admin sign-in, employee management and profile persistence use the existing APIs in `../backend`. Other operational pages still await data integration.

## Run and verify

```powershell
npm install
npm run dev
npm run lint
npm test
npm run test:e2e
npm run build
npm run format:check
```

Browser tests use the locally installed Google Chrome through Playwright. The test runner starts its own Vite server on `127.0.0.1:5173`; stop another server on that port before running. Generated screenshots, traces and the HTML report are ignored by Git. Open the HTML results with `npx playwright show-report`.

## Routes

- `/dashboard`: overview and employee status
- `/employees`: employee forms, selection and CSV exports
- `/activity-details`: sample employee activity and filtered logs
- `/application-usage`: application classifications and usage filters
- `/departments`: department forms and reassignment before deletion
- `/reports`: report generation, comparison charts and session CSV archives
- `/settings`: browser-local monitoring preferences
- `/profile`: authenticated database-backed personal information and notification preferences
- `/login`: Admin sign-in using the existing backend login and session-verification endpoints

Unknown URLs show a recovery page. The sidebar and header provide links to each dashboard page and the profile. Route components load on demand.

## Design and architecture

`src/index.css` defines the Tailwind v4 theme, Inter font and component layers. Shared `PageHeader`, `Sidebar`, `Button`, `SectionHeading`, `Notice`, `Modal` and `Toggle` components keep page chrome and controls consistent. Native dialogs provide keyboard containment, Escape dismissal and focus restoration. The mobile sidebar provides its own focus trap and makes underlying content inert while open.

The data modules contain empty record collections and pure filtering/formatting functions. Seed telemetry and simulated chart/report generation have been removed. CSV downloads use `src/utils/download.js`. Dynamic chart/progress dimensions remain data-driven styles; layout and control styling use Tailwind.

Settings drafts are validated before browser-local persistence. Personal information, notification preferences and employee records load/save through authenticated backend APIs. Employee CSV exports come from the backend; other preview archives remain page state. Passwords are never persisted in browser storage. Profile language/time-zone preferences do not translate the UI or modify backend timestamps.

## Integration limits

No backend URLs, response contracts or credentials are invented. Password changes, cross-device sign-out, MFA enforcement, notification delivery, agent monitoring and scheduled server-side archives require frontend wiring to the existing backend APIs. The UI identifies these limits and never reports successful account/security operations. PDF exports use the browser print dialog (`Save as PDF`); print views include all matching rows rather than only the visible table page.

## No seeded data

Employee records, summary counts and department options come from the authenticated management APIs. Other department, application, activity and report collections start empty. Unknown metrics display an em dash or an explicit empty state; no performance score is calculated. Earlier `workpulse.*.preview.v1` storage is ignored using new draft keys, so old seeded profile/rule values do not return on reload. Settings numbers are editable draft form defaults, not a loaded or enforced backend policy; rules/privacy text are blank and schedule days are disabled. User-entered settings drafts are still browser-only.

Checks: `npm test`, `npm run lint`, `npm run build`, and `npx playwright test tests/e2e/empty-data.spec.js`. The older seed-dependent scenarios in `dashboard.spec.js` describe the retired demo data and need separate conversion to real API fixtures before a full browser regression run.

## Admin sign-in before dashboard

Opening `/` redirects to `/login`. Dashboard and management routes are protected by an Admin session. POST `/api/v1/auth/login` is followed by GET `/api/v1/auth/me`; only the backend-verified A role is accepted, and temporary-password accounts must change their password first. No frontend role flag grants backend permissions. Sign out calls the existing logout endpoint and clears local session state.

Access/refresh tokens, their expiry and the last input timestamp are stored in tab-scoped sessionStorage. Reload restores the session only after backend verification; cached user data or roles never grant access. Existing refresh-token rotation renews access while the user remains active. Five minutes without trusted mouse, keyboard, wheel or touch input clears the session and requests backend logout. Page visibility checks enforce the deadline after browser suspension; network requests and token refresh do not count as user input. This is a browser inactivity control using the existing backend session lifecycle, not a new server-side idle policy. No passwords or key contents are stored. localStorage is not used for authentication.

Development Vite proxies `/api/v1` to the unchanged backend at `http://127.0.0.1:5000`. Production must proxy that path to the API or set `VITE_API_BASE_URL` to its actual HTTPS base, with matching backend CORS configuration. Never put Supabase server keys/JWT signing secrets in Vite variables. No database or Admin credentials are created by this change.

Run `npx playwright test tests/e2e/admin-login.spec.js` for login-first, invalid-credential, Admin/non-Admin and logout UI checks using isolated HTTP fixtures. Live Admin login additionally requires the approved deployed database schema and an existing authorized Admin account.

## Personal information persistence

GET/PUT `/api/v1/profile` uses the authenticated JWT. The existing backend writes first_name, last_name, phone, language and timezone to `wp_employee_profiles`, selected by the authenticated user_id. The client never sends a user ID, role, email or department for this update. Email/employee code/department are loaded as read-only account fields. Profile browser-storage drafts are no longer read or written.

The form loads server values before enabling edits, awaits confirmed writes, disables duplicate submissions, and preserves edits on failure. Notification preferences use their existing dedicated profile endpoint; saving them does not send an email. Photo selection is a preview only and is excluded from the personal-information request; avatar upload and password changes are separate features.

No schema changes were applied. The existing profile table was checked read-only and is available. Isolated PostgreSQL tests verify update/read persistence and ownership; browser tests in `tests/e2e/profile-persistence.spec.js` use HTTP fixtures to check persistence after reload and preservation of edits on server failure. No personal data was invented or written to the live database during implementation.

## Employee database integration

`src/services/employees.js` reuses the existing bearer-authenticated employee and department APIs. The directory uses server search, role/status/department filters and pagination. Create, edit, department reassignment, deactivate/reactivate and CSV export await actual API results. Failed saves retain the entered fields; no successful row is fabricated locally.

Add Employee sends firstName, lastName, email, phone, employeeCode, departmentId, role and a temporary password to POST `/api/v1/employees`. The backend validates the request, hashes the password and uses the existing transactional employee-write function to create `wp_auth_users` and the linked `wp_employee_profiles` row. Department IDs refer to `wp_departments`. Internal UUIDs and displayed employee codes remain separate. New accounts are active and must change their temporary password at first login. Managers are assigned through departments; no unsupported individual-manager field is sent.

The existing `001_auth.proposed.sql` and `002_core_management.proposed.sql` definitions supply these tables, constraints and server-only functions. Their required table/function metadata was confirmed available in Supabase without reading employee rows or changing live data. See `../backend/setup/EMPLOYEE_STORAGE.md` for storage details. No new migration was needed or applied.

Verification: frontend unit tests (17), backend core integration tests (31), and desktop/mobile browser checks for employee saves (2) passed. Browser fixtures validate request/response handling, acknowledgement timing, duplicate errors, edit payloads, status changes and reload persistence; isolated PostgreSQL tests validate actual transactional database writes, bcrypt hashing and rollback. Separate login/profile/session browser checks (16) passed, including refresh restoration and the five-minute inactivity boundary. These checks do not create a live employee account or claim a live end-to-end employee write.
