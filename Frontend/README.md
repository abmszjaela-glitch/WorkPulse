# WorkPulse frontend

React, React Router, Tailwind CSS v4, Lucide and Recharts power the existing dashboard. Backend APIs are implemented separately in `../backend`; Admin sign-in is connected to the existing backend authentication endpoints; operational pages still await data integration.

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
- `/profile`: browser-local personal information and notification preferences
- `/login`: Admin sign-in using the existing backend login and session-verification endpoints

Unknown URLs show a recovery page. The sidebar and header provide links to each dashboard page and the profile. Route components load on demand.

## Design and architecture

`src/index.css` defines the Tailwind v4 theme, Inter font and component layers. Shared `PageHeader`, `Sidebar`, `Button`, `SectionHeading`, `Notice`, `Modal` and `Toggle` components keep page chrome and controls consistent. Native dialogs provide keyboard containment, Escape dismissal and focus restoration. The mobile sidebar provides its own focus trap and makes underlying content inert while open.

The data modules contain empty record collections and pure filtering/formatting functions. Seed telemetry and simulated chart/report generation have been removed. CSV downloads use `src/utils/download.js`. Dynamic chart/progress dimensions remain data-driven styles; layout and control styling use Tailwind.

Settings and profile data are validated before browser-local persistence. CSV archives and edits to other preview data remain session/page state. Passwords are never persisted. The preview language/time-zone preferences do not translate the UI or modify backend timestamps.

## Integration limits

No backend URLs, response contracts or credentials are invented. Password changes, cross-device sign-out, MFA enforcement, notification delivery, agent monitoring and scheduled server-side archives require frontend wiring to the existing backend APIs. The UI identifies these limits and never reports successful account/security operations. PDF exports use the browser print dialog (`Save as PDF`); print views include all matching rows rather than only the visible table page.

## No seeded data

Employee, department, application, activity and report collections start empty. Unknown metrics display an em dash or an explicit empty state; no performance score is calculated. Profile identity and contact fields start blank. Earlier `workpulse.*.preview.v1` storage is ignored using new draft keys, so old seeded profile/rule values do not return on reload. Settings numbers are editable draft form defaults, not a loaded or enforced backend policy; rules/privacy text are blank and schedule days are disabled. User-entered local drafts are still browser-only. Operational data fetching remains unconnected; the subsequent Admin sign-in flow is described below.

Checks: `npm test`, `npm run lint`, `npm run build`, and `npx playwright test tests/e2e/empty-data.spec.js`. The older seed-dependent scenarios in `dashboard.spec.js` describe the retired demo data and need separate conversion to real API fixtures before a full browser regression run.

## Admin sign-in before dashboard

Opening `/` redirects to `/login`. Dashboard and management routes are protected by an Admin session. POST `/api/v1/auth/login` is followed by GET `/api/v1/auth/me`; only the backend-verified A role is accepted, and temporary-password accounts must change their password first. No frontend role flag grants backend permissions. Sign out calls the existing logout endpoint and clears local session state.

Access tokens stay in memory only. Reloading or access-token expiry requires sign-in again; credentials/tokens are not saved in localStorage or sessionStorage. Development Vite proxies `/api/v1` to the unchanged backend at `http://127.0.0.1:5000`. Production must proxy that path to the API or set `VITE_API_BASE_URL` to its actual HTTPS base, with matching backend CORS configuration. Never put Supabase server keys/JWT signing secrets in Vite variables. No database or Admin credentials are created by this change.

Run `npx playwright test tests/e2e/admin-login.spec.js` for login-first, invalid-credential, Admin/non-Admin and logout UI checks using isolated HTTP fixtures. Live Admin login additionally requires the approved deployed database schema and an existing authorized Admin account.
