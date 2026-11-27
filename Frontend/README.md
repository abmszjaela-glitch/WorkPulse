# WorkPulse frontend

React, React Router, Tailwind CSS v4, Lucide and Recharts power the Admin dashboard. Operational pages use the existing backend APIs; no preview datasets or synthetic metrics are shipped.

## Development

Run these commands from the Frontend directory:

    npm install
    npm run dev
    npm run lint
    npm test
    npm run build

Vite proxies /api/v1 to http://127.0.0.1:5000. Production must proxy that path or configure VITE_API_BASE_URL with the actual API base. Keep server-only Supabase keys and JWT signing secrets out of Vite variables. The generated dist directory is ignored by Git.

## Authentication and data

Opening / redirects to /login. The dashboard, employees, activity-details, application-usage, departments, reports, settings and profile routes require a backend-verified Admin session. Session restoration verifies the backend user before allowing access. Five minutes without trusted user input clears the session and requests logout.

Employee management, profile changes, settings, analytics and exports use authenticated APIs. Writes await server acknowledgement and preserve edits on errors. Personal information uses wp_employee_profiles through the profile endpoint; read-only identity fields are not submitted as profile changes. Profile browser-storage drafts are no longer loaded. Unknown metrics remain unavailable; no productivity score formula is assumed.

See ../backend/README.md and ../backend/setup/AGENT_INTEGRATION.md for API/database prerequisites. SQL migrations are maintained in the backend.

## Verification

    npm run test:e2e

Playwright uses locally installed Chrome and starts Vite on 127.0.0.1:5173. Stop any existing server on that port first. Current browser tests use isolated API fixtures for authentication, session timeout, employee changes, profile persistence and Agent analytics. Reports, screenshots and traces are generated outputs and ignored by Git.

For an already running Vite server on port 4177, use:

    npx playwright test --config playwright.integration.config.js

Production data and employee credentials are not required by these regression tests.
