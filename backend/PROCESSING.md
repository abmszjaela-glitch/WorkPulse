# Validation and daily processing

Phase 5 adds reusable validators under `validators/` for management, authentication,
monitoring, settings sections, report filters and application categories. Existing
`validator` and `express-validator` dependencies are reused. Text is trimmed and
normalized without modifying passwords. Unexpected fields and malformed types are
rejected. Queries use bound Supabase/RPC arguments, not interpolated user SQL.
Settings validators reuse existing dashboard section field names; no settings or
reports endpoint is invented in this phase. The legacy ignored login role field
remains compatible and never grants permissions.

## Application categories

All routes use `/api/v1/app-categories`:

- GET `/`: Admin/Manager, scoped list with pagination/search/category/department filters.
- POST `/`: Admin; `{applicationName,category,departmentId?}`.
- PUT `/:id`: Admin; partial update of those fields.
- DELETE `/:id`: Admin; soft deletion.
- GET `/lookup`: registered Agent; global rules plus its department overrides.

Categories are Productive, Neutral and Unproductive. Names use the existing process
name validator, case normalization and duplicate constraints. Unknown apps remain
unclassified. No default app categories are seeded or guessed.

## Daily calculations

`services/daily-summaries.js` provides trusted internal recalculation and scheduled
processing. Summaries store monitored, active, idle, productive, neutral,
unproductive and unclassified duration totals separately. `productivity_score`
is always null, with an explicit unavailable reason. No percentage or score formula
has been approved or implemented; the database also prohibits a non-null score.

Days use configured IANA timezone boundaries in PostgreSQL, including DST. Intervals
crossing midnight are proportionally allocated and explicitly marked as prorated:
the source contains interval totals, not exact within-interval event times. Totals
are summed device time; simultaneous devices can overlap in wall-clock time.
Current category rules/current department determine classification, and rule changes
invalidate cached summaries. Raw intervals are never changed or deleted.

Exact paused duration remains unavailable (`paused_seconds: null`) because complete
heartbeat history is absent. `reported_paused_seconds` separately totals bounded
explicit PAUSED transitions. Employee status information comes from actual explicit
events at day end, not today's device state. Empty days return actual zero observed
duration, unavailable score and a data-completeness warning. Late uploads can amend
closed-day results.

## Scheduling and recovery

`services/summary-worker.js` uses a bounded, non-overlapping timer to wake durable
database jobs. No dependency or cron daemon is required. Jobs are unique by employee,
local date and timezone. Transactional row locks/`SKIP LOCKED` prevent duplicate work;
unchanged summaries do not get rewritten. Failed jobs retain safe error codes and
retry with backoff. A durable date cursor catches up after restarts. New intervals,
status events, department changes and category edits mark affected jobs pending.
Closed days only are processed. Shutdown cancels the timer and awaits current work.

The worker is **disabled by default**. After migration approval, configure:

```dotenv
DAILY_SUMMARY_WORKER_ENABLED=true
SUMMARY_TIMEZONE=Asia/Colombo
SUMMARY_START_DATE=
SUMMARY_LOOKBACK_DAYS=30
SUMMARY_CATCHUP_DAYS=7
SUMMARY_MAX_JOBS_PER_RUN=50
SUMMARY_DELAY_MINUTES=5
SUMMARY_POLL_SECONDS=60
```

Trusted manual recalculation, after approval/configuration:

```text
node scripts/recalculate-summary.js --employee <UUID> --date YYYY-MM-DD --timezone Asia/Colombo --confirm
```

This is an operator command, not a public API. It uses the server-only database key.
Failure logs omit credentials, employee details and raw database diagnostics.

## Database and verification

`migrations/004_processing.proposed.sql` depends on proposals 001–003 and introduces
category rules/revision, daily summaries, jobs and schedule cursor tables, plus
constraints, indexes, RLS browser-deny policies and service-only RPCs/triggers.
It is a review proposal: no live migration or production data change was performed.
Supabase schema inspection returned HTTP 200 with no exposed table definitions;
private schema review remains required. No existing data is deleted.

`tests/processing.test.js` exercises the exact SQL with isolated PostgreSQL and real
local HTTP: permissions, duplicates, classification, empty/multiple employee days,
23/25-hour DST days, proration, pause limitations, idempotence, restart recovery,
late data, reclassification, durable failures, RLS and worker shutdown. The initial
processing-specific run passed 18/18 tests; four additional reusable-validator tests
passed. The preceding full regression run passed 100/100 tests.
Real multi-process load testing and live scheduled execution are not claimed.
