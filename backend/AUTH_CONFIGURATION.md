# Authentication startup configuration

The startup failure was a name mismatch: the existing private `.env` supplied
`JWT_SECRET`, while authentication read only `AUTH_JWT_SECRET`. Dotenv already
loaded before auth initialization and correctly used `backend/.env` regardless
of the terminal working directory. The existing server-only key was present.
No private `.env` values were changed and no credentials were generated.

Required variables in `backend/.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=
AUTH_JWT_SECRET=
PORT=5000
```

Supply your actual project URL and backend-only Supabase `sb_secret_` key (or
legacy JWT `service_role` key). `SUPABASE_PUBLISHABLE_KEY` is never a backend
fallback. A publishable/anon key copied into SUPABASE_SECRET_KEY is rejected.
Format/role classification is not cryptographic verification; actual database
credential acceptance is performed by Supabase on requests.

Configure **one** of `AUTH_JWT_SECRET` (preferred) or your existing `JWT_SECRET`.
The existing JWT_SECRET now works unchanged. The signing secret must be at least
32 bytes, cryptographically random and private. If both names are nonempty and
different, startup fails rather than silently switching signing keys. Neither
value is logged. Do not replace an existing valid signing key merely to rename
the variable: that would invalidate existing tokens. Use a dedicated WorkPulse
custom-auth signing secret, not a public key or Supabase Auth token.

Process environment takes precedence over `.env` using dotenv's standard
non-overriding behavior. Clear stale/blank exported values before restarting if
they mask the file's configuration. `.env` is ignored by Git. SMTP configuration
is separate and not required just to construct authentication services.

Missing/invalid required configuration now terminates startup **before listening**
with `Startup configuration error: <variable name and safe rule>`. It no longer
starts a degraded server without authentication. Startup success prints:

```text
Authentication initialized successfully
WorkPulse API listening on port 5000
```

Restart `npm start` or your existing `npm run dev` process to load changes.
Port configuration/default and the database schema are unchanged. Local service
construction was verified with the existing private configuration. This confirms
initialization, not live employee login or deployment of proposed auth tables;
database migrations remain subject to explicit approval.

Verification on 2026-11-22: full automated suite **146/146 PASS**, including
missing-key startup exit, JWT alias/conflict handling and rejection of public
keys. With the actual private local configuration, auth service construction
succeeded. The already running server on unchanged port 5000 returned health
200 and unauthenticated `/api/v1/auth/me` 401 (not an auth-unconfigured 503).
A second server startup correctly reported that the port was already in use;
the existing process was not stopped. No real employee login or database write
was attempted. Test output: `reports/auth-configuration-test-output.tap`.
