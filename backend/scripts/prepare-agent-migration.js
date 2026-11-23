// Generate a review artifact only; this script has no DB connection or secrets.
import {readFile,writeFile} from 'node:fs/promises';
const migrations=['003_monitoring','004_processing','005_analytics','006_reports','007_system'];
const pieces=await Promise.all(migrations.map(async name=>
  `\n-- SOURCE: migrations/${name}.proposed.sql\n`+(await readFile(new URL('../migrations/'+name+'.proposed.sql',import.meta.url),'utf8')).replace(/^\s*(begin|commit);\s*$/gm,'')));
const guard=`-- REVIEW ONLY. Explicit approval is required before applying to live Supabase.
-- Generated from the existing reviewed proposals. Do not reapply 001 or 002.
-- All five phases run in one transaction; an error rolls the whole bundle back.
begin;
do $$
begin
 if to_regclass('public.wp_auth_users') is null or to_regclass('public.wp_employee_profiles') is null then
  raise exception 'Existing authentication/core schema 001 and 002 is required';
 end if;
 if exists(select 1 from unnest(array['wp_activity_intervals','wp_application_usage','wp_device_presence','wp_status_events',
   'wp_app_category_rules','wp_daily_summaries','wp_summary_jobs','wp_summary_schedules','wp_report_exports',
   'wp_system_settings','wp_notifications','wp_audit_logs','wp_realtime_events','wp_device_connectivity']) t(name)
   where to_regclass('public.'||name) is not null) then
  raise exception 'A later phase already exists. Review deployment state instead of duplicating tables';
 end if;
end $$;
`;
await writeFile(new URL('../setup/AGENT_INTEGRATION_REVIEW.sql',import.meta.url),guard+pieces.join('\n')+'\ncommit;\n');
console.log('Prepared setup/AGENT_INTEGRATION_REVIEW.sql for review. No database connection was made.');
