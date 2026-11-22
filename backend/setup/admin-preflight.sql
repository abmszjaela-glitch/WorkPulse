-- READ ONLY: run in the intended Supabase project's SQL Editor before migration 001.
-- An empty result means no matching public WorkPulse tables were found.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public' and table_name like 'wp\_%' escape '\'
order by table_name;

-- Existing functions also require review before applying the CREATE migration.
select n.nspname as schema_name, p.proname as function_name
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'wp\_auth\_%' escape '\'
order by p.proname;
