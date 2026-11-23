// Read-only schema probes: zero rows returned, no inserts, migrations or DDL.
import {createClient} from '@supabase/supabase-js';
import {supabaseUrl,supabaseKey} from '../config/environment.js';

const client=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})}});
const resources=[
  ['wp_auth_users','id'],['wp_auth_devices','id,user_id,registered_at,last_seen'],
  ['wp_employee_profiles','user_id,department_id'],['wp_departments','id'],
  ['wp_privacy_policies','version,is_current'],['wp_consent_receipts','user_id,policy_version,accepted_at'],
  ['wp_activity_intervals','device_id,record_id,employee_id,interval_start,interval_end,mouse_movements,mouse_clicks,key_presses'],
  ['wp_application_usage','device_id,record_id,application_name,duration_seconds'],
  ['wp_device_presence','device_id,reported_status'],['wp_status_events','employee_id,status'],
  ['wp_app_category_rules','application_name,category'],['wp_daily_summaries','employee_id'],
  ['wp_report_exports','id'],['wp_system_settings','section,value'],['wp_notifications','id'],['wp_audit_logs','id'],
];
const checks=await Promise.all(resources.map(async([name,columns])=>{
  try{const result=await client.from(name).select(columns).limit(0);
    return {name,ready:!result.error&&Array.isArray(result.data),code:result.error?(result.error.code||'REQUEST_FAILED'):null};}
  catch{return {name,ready:false,code:'REQUEST_FAILED'};}
}));
// Publicly report only readiness and fixed database error codes, never raw errors.
console.log(JSON.stringify({ready:checks.every(row=>row.ready),checks,liveDataChanged:false},null,2));
if(checks.some(row=>!row.ready))process.exitCode=1;
