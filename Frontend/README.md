# WorkPulse frontend

React, React Router, Tailwind CSS v4, Lucide and Recharts power the existing dashboard. The backend directory currently contains dependencies and empty implementation folders; no API, authentication middleware or database integration is implemented.

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
- `/login`: login form and validation; backend sign-in is not available

Unknown URLs show a recovery page. The sidebar and header provide links to each dashboard page and the profile. Route components load on demand.

## Design and architecture

`src/index.css` defines the Tailwind v4 theme, Inter font and component layers. Shared `PageHeader`, `Sidebar`, `Button`, `SectionHeading`, `Notice`, `Modal` and `Toggle` components keep page chrome and controls consistent. Native dialogs provide keyboard containment, Escape dismissal and focus restoration. The mobile sidebar provides its own focus trap and makes underlying content inert while open.

The data modules contain the existing sample telemetry and pure filtering/aggregation functions. CSV downloads use `src/utils/download.js`. Dynamic chart/progress dimensions remain data-driven styles; layout and control styling use Tailwind.

Settings and profile data are validated before browser-local persistence. CSV archives and edits to other preview data remain session/page state. Passwords are never persisted. The preview language/time-zone preferences do not translate the UI or modify backend timestamps.

## Integration limits

No backend URLs, response contracts or credentials are invented. Login, password changes, cross-device sign-out, MFA enforcement, notification delivery, agent monitoring and scheduled server-side archives require backend implementation. The UI identifies these limits and never reports successful account/security operations. PDF exports use the browser print dialog (`Save as PDF`); print views include all matching rows rather than only the visible table page.
