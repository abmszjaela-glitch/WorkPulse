# WorkPulse reporting and exports

Phase 7 adds 10 Admin/Manager-only endpoints under `/api/v1/reports`. Frontend
ReportsPage and data/reports.js were inspected: they use static preview records,
illustrative chart factors and browser-local CSV/export history, with no HTTP API
contract. Those mock statistics/formulas were not copied into backend reporting.
Frontend and agent source remain unchanged.

## Endpoints and filters

| GET path | Purpose/default period |
| --- | --- |
| `/daily` | Employee report; today |
| `/weekly` | Rolling seven calendar days ending today |
| `/monthly` | Calendar month to date |
| `/department/:id` | Department-scoped employee report; seven days |
| `/employee/:id` | Employee-scoped report; seven days |
| `/kpis` | Actual monitoring totals; seven days |
| `/charts` | Date-bucket activity, category usage shares, department durations |
| `/recent-exports` | Caller-owned, currently authorized export history |
| `/export/csv` | Download authorized report rows |
| `/export/pdf` | Download paginated PDF report |

Report filters use `from`, `to` (inclusive local dates), IANA `timezone`,
`employeeId`, `departmentId`, `reportType=summary|activity|application-usage`, `page`
and `pageSize` (maximum 100). Unknown fields, reversed/excessive ranges, invalid IDs
and contradictory path/query scopes fail. History accepts pagination only. Explicit
date filters override period defaults. JSON uses success/message/data, pagination
and period metadata; export endpoints return attachment bytes, not JSON.

Summary rows contain real employee identity, department, monitored/active/idle time,
classified application durations, observed activity days and top application.
Activity reports contain aggregate interval rows; app-usage reports group employee,
application and classification. Observed days mean dates with actual records, not
scheduled attendance. Productivity, attendance and overtime remain unavailable/null:
no business formula is invented. PDF duration display rounds to seconds; JSON/CSV
retain stored precision. Current categories/department scope and proportional
interval-boundary allocation follow previous phases. Raw input activity scores are
not employee performance metrics. No fake chart factors or sample employee totals
are used. Empty application reports contain no fabricated rows; summary reports may
include authorized existing employees with zero observed duration.

## Security and persistence

Existing JWT middleware and database role/scope checks protect every route. Managers
see only permitted employees; a path/department filter cannot expand their scope.
Exports persist metadata only after successful file generation and a second current
scope check. History is owner-only and rechecks all exported employee IDs against
current permissions. Losing department scope hides old exports containing those
employees. Internal employee-ID arrays and local filesystem paths are never returned.

Supabase schema inspection returned HTTP 200 with no exposed tables or RPCs; private
schemas may still contain data. No existing export-history structure could be
verified. Review `migrations/006_reports.proposed.sql` after 001–005. It proposes
`wp_report_exports`: UUID, requested user, format, report type, period, timezone,
filename, byte size, SHA-256, row count, internal employee IDs and generated timestamp.
It includes constraints, owner/time index, RLS browser-deny policy and service-only
RPCs. No migration was applied and no production data was changed or deleted.

History records **generated**, not proven downloaded, files. Client disconnect does
not create a false delivery claim. Files are ephemeral and removed after transfer
or failure. There is no public archive/file URL or invented re-download endpoint;
users regenerate reports through the authorized export endpoint. Deploy under a
service account with private OS temporary-directory permissions. Files request
mode 0600 on systems supporting Unix permissions; Windows inherits directory ACLs.

## CSV and PDF implementation

CSV is UTF-8 with BOM, explicit column headers/units, quoted fields, doubled quotes
and spreadsheet-formula neutralization, including leading whitespace. Rows stream
to a temporary file using write backpressure, then Express downloads it with correct
attachment headers. The database returns bounded aggregated report rows, not all
raw telemetry fetched for JavaScript calculation. Default CSV limit is 10,000 rows.

PDFKit is the added production library. Landscape A4 pages have WorkPulse title,
generated UTC date, period/timezone, employee/department scope, actual KPI totals,
repeated table headers, wrapping/alternating rows and page numbers. Data columns
vary by report type; summary displays monitored/active/idle time and observed days.
Default PDF limit is 2,000 rows. Limits fail with 413 rather than truncate; narrow
filters for larger data. PDFKit buffers bounded pages for correct total page numbers.
No charts are drawn from fake data. Configure `REPORT_FONT_PATH` to a server-controlled
font covering the languages in employee names; default PDFKit Helvetica is not a
promise of support for every Unicode script. HTTP callers cannot select font paths.

```dotenv
REPORT_CSV_MAX_ROWS=10000
REPORT_PDF_MAX_ROWS=2000
REPORT_FONT_PATH=
```

The report SQL aggregates intervals, categories, observed dates and top apps in
PostgreSQL using scope-filtered CTEs. Each report uses one bound RPC, without a
per-employee HTTP query loop. Export generation uses one data snapshot plus a metadata
insert. Charts reuse the existing SQL aggregations. Exports deliberately ignore
pagination while preserving filters, check total row count and refuse oversized
results. Production EXPLAIN/load testing remains a deployment task.

## Samples and verification

`reports/samples/WorkPulse-report.csv` and `WorkPulse-report.pdf` are actual files
returned by local integration HTTP requests using synthetic PostgreSQL identities
and monitoring records. `WorkPulse-large-report.pdf` tests 94 synthetic employee
rows across seven pages. These are labeled test data, not production employee reports.
`reports/phase7-http-examples.json` captures observed JSON/header/file-size results
with no authorization secrets.

Reporting-specific tests: **9 passed**. Final full backend regression after the
footer correction: **122 passed, 0 failed**. Production dependency audit: 0 reported vulnerabilities.
Tests cover all endpoints, Admin/Manager/Employee/Agent permissions, daily/weekly/
monthly data, department/employee/date filters, all report types, pagination, correct
totals, empty reports, CSV formulas/quotes, PDF files, large multipage reports,
owner/scope history, missing records, row limits, database failures and RLS.

The generated seven-page volume PDF was rendered with temporary PyMuPDF QA tooling
outside project dependencies. Every page's header/page numbering was checked, and
first/last page images were visually inspected. A footer-induced blank-page issue
was corrected and re-rendered. PNGs are QA intermediates, not report deliverables.
No renderer/AI dependencies were added to the production backend.

Live migration, real employee exports, frontend integration, production-scale load,
real service-account temporary-directory ACLs and multilingual font coverage remain
NOT TESTED. Signing configuration and explicit migration approval remain required.
The backend does not automatically activate previously unapproved database changes.

Added: report config/service/file generator/controller/router, 006 proposed SQL,
integration tests, samples and reports. Modified: app mounting, environment template,
package.json/package-lock.json (PDFKit). No unrelated frontend/agent changes.
