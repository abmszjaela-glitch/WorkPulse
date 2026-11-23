# Dashboard and activity analytics

Phase 6 adds the 19 GET endpoints declared in `routes/analytics.js`, under `/api/v1`.
Employee activity, timeline, interval log, summary and trend use `/activity/employee/:id`;
`/activity/me` is Employee-only, `/activity/me/summary` Employee/registered Agent.
Application usage includes list/top/categories-breakdown/trend/employee/:id/export.
Dashboard includes stats/active-vs-idle/app-usage-summary/live-status/top-apps/
department-productivity. All management analytics require Admin or scoped Manager.

## Inspected frontend and database

DashboardPage, ActivityDetailsPage and ApplicationUsagePage import static preview
datasets. No fetch/axios API calls exist in `Frontend/src`; there is no established
HTTP response contract to overwrite. No frontend or agent source was changed.
The views need KPI totals, hourly bars, seven-day charts, application/category
durations, employee live rows and department charts. Mock statistics and percentage
adjustments in frontend previews were not reused as backend facts.

Supabase schema metadata returned HTTP 200 with only `/` and no exposed tables.
Private schema contents are not asserted empty. Review
`migrations/005_analytics.proposed.sql` after approved 001–004; nothing was applied
to live Supabase. It reuses interval/app/status/device/profile/department/category
tables and adds indexes and service-role-only aggregation functions, not fake data.

## Contract and calculations

JSON success responses contain `success:true`, `message`, `data`, optional
`pagination:{page,pageSize,total,totalPages}` and `meta:{from,to,timezone,...}`.
Analytics errors include `success:false`, safe message, `data:null` and the existing
error object. Older API error contracts remain unchanged. CSV export intentionally
returns a quoted, formula-safe CSV attachment rather than JSON.

Common filters: inclusive calendar dates `from`,`to`, IANA `timezone`, management
`departmentId`, `page` and `pageSize` (maximum 100). Default timezone follows summary
configuration. Default range is today; trend/active-vs-idle charts default to seven
days ending today. Date ranges are bounded to 366 days; hourly timelines to 31 days.
Interval logs also accept ACTIVE/IDLE `status` and process `applicationName` filters;
live rows accept search and ACTIVE/IDLE/PAUSED/OFFLINE/UNKNOWN filters. Unknown
fields and invalid dates/IDs are rejected. Own endpoints cannot accept another ID.

Intervals are clipped proportionally at timezone-aware boundaries, as in Phase 5.
Metrics are seconds of summed device intervals; overlapping devices may exceed
employee wall-clock time. Hour buckets carry UTC timestamps to distinguish repeated
DST hours. Daily charts use local calendar dates and zero-fill empty buckets from
SQL; zeros mean no observed records, not fabricated work or complete data coverage.
Logs expose aggregate intervals and counts, not window/document content. Counts in
partially overlapping log records remain original interval counts with a fraction
field; fractional keystroke counts are not invented.

Application totals join the existing usage table to scoped intervals. Current
department-specific rules override global rules. Unknown apps are Unclassified.
Category percentages use **all observed application duration**, including
Unclassified, as denominator. Empty denominators return null percentages. These
are usage shares, never a productivity score. Mixed per-department classifications
for one app return a null overall category, while the category breakdown retains
correct scoped duration totals. Input activity scores are not performance metrics.

Department charts return real active/idle/monitored duration totals with
`productivity_score:null`. No productivity percentage, benchmark or score was
introduced. Exact paused duration remains unavailable; KPI `paused_seconds` is null.
Current live status is separate from historical duration charts. For multiple
devices the explicit precedence is ACTIVE, then IDLE, then PAUSED; an online device
without a reported state yields UNKNOWN, otherwise OFFLINE. Inactive accounts are
OFFLINE. Counts include all nondeleted scoped employees and expose paused/unknown
buckets so totals reconcile. Offline detection reuses the shared heartbeat timeout.

## Queries and performance

`services/analytics.js` makes one bound Supabase RPC per request. Database functions
apply authenticated identity/Manager department scope before returning data, then
aggregate counts/durations and page rows in PostgreSQL. No employee-by-employee
HTTP/N+1 queries or fetch-all-and-sum JavaScript loops are used. Charts perform
bounded database bucket aggregation (up to 367 daily/744-ish hourly buckets), so
large-range load performance still requires deployment measurements. Interval
employee/time indexes and latest-status indexes are proposed. CSV uses one snapshot,
up to 10,000 distinct apps, then returns 413 rather than truncating. Filters use bound
parameters; no user-supplied SQL identifiers are constructed.

## Verification and deployment limits

The final full suite passed **113/113 tests**, including 9 analytics integration tests.
Analytics integration tests cover all 19 routes with every denied role,
realistic synthetic PostgreSQL intervals/app records, date/department filtering,
Manager/self scope, accurate totals/shares, empty results, pagination, seven-day
zero-fill, 23/25-hour DST timelines, dashboard counts, unavailable productivity and
safe database failures. Tests use exact proposed SQL and real local HTTP, not mocked
chart responses. See `reports/phase6-http-examples.json` for observed responses with
synthetic identities and no credentials. Re-running analytics tests regenerates it.

No new dependencies. Live migrations, live analytics, real frontend integration,
EXPLAIN/production load measurements and multi-process load tests are NOT TESTED.
Signing configuration and explicit migration approval are still required before
deployment. Existing mock frontend screens remain unchanged until authorized
integration work connects them to these endpoints.
