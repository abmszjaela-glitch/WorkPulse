-- READ ONLY. These objects/columns belong to migration 002, not authentication 001.
select table_name
from information_schema.tables
where table_schema='public' and table_name in
 ('wp_departments','wp_employee_profiles','wp_privacy_policies','wp_consent_receipts','wp_core_employees')
order by table_name;

select table_name,column_name
from information_schema.columns
where table_schema='public' and
 ((table_name='wp_auth_users' and column_name='deleted_at') or
  (table_name='wp_auth_devices' and column_name in ('name','platform','registered_at','last_seen','deleted_at')))
order by table_name,column_name;

select p.proname as function_name
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'wp\_core\_%' escape '\'
order by p.proname;
