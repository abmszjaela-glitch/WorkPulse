-- REVIEW ONLY. Explicit approval is required before applying to live Supabase.
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

-- SOURCE: migrations/003_monitoring.proposed.sql
-- REVIEW ONLY. Requires approved 001 + 002. No live execution is performed.
create table public.wp_activity_intervals (
  device_id uuid not null references public.wp_auth_devices(id), record_id uuid not null,
  employee_id uuid not null references public.wp_auth_users(id),
  interval_start timestamptz not null, interval_end timestamptz not null,
  interval_seconds double precision not null check(interval_seconds>=0 and interval_seconds<'Infinity'::float8),
  mouse_movements bigint not null check(mouse_movements>=0), mouse_clicks bigint not null check(mouse_clicks>=0),
  key_presses bigint not null check(key_presses>=0), active_seconds double precision not null check(active_seconds>=0 and active_seconds<'Infinity'::float8),
  idle_seconds double precision not null check(idle_seconds>=0 and idle_seconds<'Infinity'::float8),
  summary jsonb not null, content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default clock_timestamp(),
  primary key(device_id,record_id), unique(device_id,interval_start,interval_end),
  check(interval_end>=interval_start), check(abs(active_seconds+idle_seconds-interval_seconds)<=greatest(0.000001,interval_seconds*0.000001))
);
create index on public.wp_activity_intervals(employee_id,interval_start);
create table public.wp_application_usage (
  device_id uuid not null, record_id uuid not null, application_name text not null check(length(application_name) between 1 and 255),
  duration_seconds double precision not null check(duration_seconds>=0 and duration_seconds<'Infinity'::float8),
  primary key(device_id,record_id,application_name),
  foreign key(device_id,record_id) references public.wp_activity_intervals(device_id,record_id)
);
create table public.wp_status_events (
  device_id uuid not null references public.wp_auth_devices(id), record_id uuid not null,
  employee_id uuid not null references public.wp_auth_users(id),
  status text not null check(status in ('ACTIVE','IDLE','PAUSED','OFFLINE')),
  occurred_at timestamptz not null default clock_timestamp(), primary key(device_id,record_id)
);
create index on public.wp_status_events(employee_id,occurred_at);
create table public.wp_device_presence (
  device_id uuid primary key references public.wp_auth_devices(id),
  reported_status text not null check(reported_status in ('ACTIVE','IDLE','PAUSED','OFFLINE')),
  status_at timestamptz not null
);

create function public.wp_monitoring_authorize(p_actor uuid,p_device uuid,p_session uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare u public.wp_auth_users;
begin
  if p_device is null then raise sqlstate 'PT403' using message='Device authentication required'; end if;
  select * into u from public.wp_auth_users where id=p_actor and is_active and deleted_at is null and not must_change_password for update;
  if not found then raise sqlstate 'PT403' using message='Employee unavailable'; end if;
  perform 1 from public.wp_auth_devices where id=p_device and user_id=p_actor and is_active and deleted_at is null and registered_at is not null for update;
  if not found then raise sqlstate 'PT403' using message='Registered device required'; end if;
  perform 1 from public.wp_auth_sessions where id=p_session and user_id=p_actor and device_id=p_device
    and revoked_at is null and expires_at>clock_timestamp() and auth_version=u.auth_version for update;
  if not found then raise sqlstate 'PT401' using message='Device session invalid'; end if;
end $$;

create function public.wp_monitoring_device_state(p_device uuid,p_timeout integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d public.wp_auth_devices; reported text; at_time timestamptz; connected boolean;
begin
  if p_timeout is null or p_timeout<1 or p_timeout>86400 then raise sqlstate 'PT400' using message='Invalid offline timeout'; end if;
  select * into d from public.wp_auth_devices where id=p_device;
  if not found then raise sqlstate 'PT404' using message='Device not found'; end if;
  select reported_status,status_at into reported,at_time from public.wp_device_presence where device_id=p_device;
  connected:=d.is_active and d.deleted_at is null and d.registered_at is not null
    and d.last_seen is not null and d.last_seen>=now()-make_interval(secs=>p_timeout)
    and exists(select 1 from public.wp_auth_users where id=d.user_id and is_active and deleted_at is null);
  return jsonb_build_object('connectionState',case when connected then 'ONLINE' else 'OFFLINE' end,
    'reportedStatus',reported,'effectiveStatus',case when connected then reported else 'OFFLINE' end,
    'statusAt',at_time,'offlineTimeoutSeconds',p_timeout);
end $$;

create function public.wp_monitoring_ingest_one(p_actor uuid,p_device uuid,p_record jsonb,p_policy jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.wp_activity_intervals; s timestamptz:=(p_record->>'interval_start')::timestamptz;
  e timestamptz:=(p_record->>'interval_end')::timestamptz; rid uuid:=(p_record->>'record_id')::uuid;
  data jsonb:=p_record->'summary'; applicable_version integer; app record;
begin
  if p_record->>'claimed_employee_id'<>p_actor::text and not exists(select 1 from public.wp_employee_profiles
    where user_id=p_actor and employee_code=p_record->>'claimed_employee_id')
    then raise sqlstate 'PT403' using message='Employee identity does not match authenticated device'; end if;
  select * into existing from public.wp_activity_intervals where device_id=p_device and record_id=rid;
  if found then
    if existing.content_hash<>p_record->>'content_hash' then raise sqlstate 'PT409' using message='Record ID conflicts with stored data'; end if;
    return jsonb_build_object('record_id',rid,'status','duplicate','http_status',200);
  end if;
  if exists(select 1 from public.wp_activity_intervals where device_id=p_device and interval_start=s and interval_end=e)
    then raise sqlstate 'PT409' using message='Interval already stored under another record ID'; end if;
  if s<clock_timestamp()-make_interval(days=>(p_policy->>'maxAgeDays')::integer)
    or e>clock_timestamp()+make_interval(secs=>(p_policy->>'futureSkewSeconds')::integer)
    or e<s or extract(epoch from e-s)>(p_policy->>'maxIntervalSeconds')::integer+(p_policy->>'clockToleranceSeconds')::integer
    then raise sqlstate 'PT400' using message='Activity timestamps outside allowed range'; end if;
  if s<e and exists(select 1 from public.wp_activity_intervals where device_id=p_device and interval_start<e and interval_end>s)
    then raise sqlstate 'PT409' using message='Activity interval overlaps stored data'; end if;
  -- Offline records use the policy effective at collection, not upload time.
  select version into applicable_version from public.wp_privacy_policies where created_at<=e order by created_at desc,version desc limit 1;
  if applicable_version is null or not exists(select 1 from public.wp_consent_receipts where user_id=p_actor
    and policy_version=applicable_version and accepted_at<=s)
    then raise sqlstate 'PT403' using message='Recorded interval lacks applicable employee consent'; end if;
  insert into public.wp_activity_intervals(device_id,record_id,employee_id,interval_start,interval_end,interval_seconds,
    mouse_movements,mouse_clicks,key_presses,active_seconds,idle_seconds,summary,content_hash)
    values(p_device,rid,p_actor,s,e,(data->>'interval_seconds')::float8,(data->'counts'->>'mouse_movements')::bigint,
      (data->'counts'->>'mouse_clicks')::bigint,(data->'counts'->>'key_presses')::bigint,(data->>'active_seconds')::float8,
      (data->>'idle_seconds')::float8,data,p_record->>'content_hash');
  for app in select key,value from jsonb_each_text(data->'application_usage_seconds') loop
    insert into public.wp_application_usage(device_id,record_id,application_name,duration_seconds) values(p_device,rid,app.key,app.value::float8);
  end loop;
  return jsonb_build_object('record_id',rid,'status','accepted','http_status',201);
end $$;

create function public.wp_monitoring_batch(p_actor uuid,p_device uuid,p_session uuid,p_kind text,p_records jsonb,p_policy jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; outcome jsonb; results jsonb:='[]'; code text; message text;
begin
  perform public.wp_monitoring_authorize(p_actor,p_device,p_session);
  if p_kind not in ('activity','app-usage') or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)<1
    or jsonb_array_length(p_records)>(p_policy->>'maxBatchSize')::integer then raise sqlstate 'PT400' using message='Invalid upload batch'; end if;
  for item in select value from jsonb_array_elements(p_records) loop
    begin
      outcome:=public.wp_monitoring_ingest_one(p_actor,p_device,item->'record',p_policy);
    exception when sqlstate 'PT400' or sqlstate 'PT403' or sqlstate 'PT409' then
      get stacked diagnostics code=returned_sqlstate,message=message_text;
      outcome:=jsonb_build_object('record_id',item->'record'->>'record_id','status','rejected','http_status',substring(code from 3)::integer,
        'error',jsonb_build_object('message',message));
    end;
    results:=results||jsonb_build_array(outcome||jsonb_build_object('index',(item->>'index')::integer));
  end loop;
  update public.wp_auth_devices set last_seen=clock_timestamp() where id=p_device;
  return results;
end $$;

create function public.wp_monitoring_status(p_actor uuid,p_device uuid,p_session uuid,p_status text,p_id uuid,p_policy jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.wp_status_events; duplicate boolean:=false;
begin
  perform public.wp_monitoring_authorize(p_actor,p_device,p_session);
  if p_status not in ('ACTIVE','IDLE','PAUSED','OFFLINE') then raise sqlstate 'PT400' using message='Invalid device status'; end if;
  select * into existing from public.wp_status_events where device_id=p_device and record_id=p_id;
  if found then
    if existing.status<>p_status then raise sqlstate 'PT409' using message='Idempotency key conflicts with stored status'; end if;
    duplicate:=true;
  else
    if p_status in ('ACTIVE','IDLE') and not exists(select 1 from public.wp_consent_receipts c
      join public.wp_privacy_policies p on p.version=c.policy_version where c.user_id=p_actor and p.is_current)
      then raise sqlstate 'PT403' using message='Current employee consent required'; end if;
    insert into public.wp_status_events(device_id,record_id,employee_id,status) values(p_device,p_id,p_actor,p_status) returning * into existing;
    insert into public.wp_device_presence(device_id,reported_status,status_at) values(p_device,p_status,existing.occurred_at)
      on conflict(device_id) do update set reported_status=excluded.reported_status,status_at=excluded.status_at;
  end if;
  update public.wp_auth_devices set last_seen=clock_timestamp() where id=p_device;
  return jsonb_build_object('record_id',p_id,'status',p_status,'occurred_at',existing.occurred_at,'duplicate',duplicate)
    ||public.wp_monitoring_device_state(p_device,(p_policy->>'offlineTimeoutSeconds')::integer);
end $$;

-- Preserve the existing management implementation and augment its responses.
alter function public.wp_core_devices(uuid,uuid,text,uuid,jsonb) rename to wp_core_devices_base;
create function public.wp_core_devices(p_actor uuid,p_device uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; item jsonb; items jsonb:='[]'; timeout integer:=(p_data->>'offlineTimeoutSeconds')::integer;
begin
  result:=public.wp_core_devices_base(p_actor,p_device,p_action,p_id,p_data);
  if p_action in ('list','get') then
    for item in select value from jsonb_array_elements(result->'items') loop
      items:=items||jsonb_build_array(item||public.wp_monitoring_device_state((item->>'id')::uuid,timeout));
    end loop;
    return jsonb_set(result,'{items}',items);
  elsif p_action in ('heartbeat','agent-config') then return result||public.wp_monitoring_device_state(p_device,timeout);
  else return result; end if;
end $$;

alter table public.wp_activity_intervals enable row level security;
alter table public.wp_application_usage enable row level security;
alter table public.wp_status_events enable row level security;
alter table public.wp_device_presence enable row level security;
create policy wp_intervals_deny_browser on public.wp_activity_intervals for all to anon,authenticated using(false) with check(false);
create policy wp_apps_deny_browser on public.wp_application_usage for all to anon,authenticated using(false) with check(false);
create policy wp_status_deny_browser on public.wp_status_events for all to anon,authenticated using(false) with check(false);
create policy wp_presence_deny_browser on public.wp_device_presence for all to anon,authenticated using(false) with check(false);
revoke all on public.wp_activity_intervals,public.wp_application_usage,public.wp_status_events,public.wp_device_presence from public,anon,authenticated;
grant select,insert,update on public.wp_activity_intervals,public.wp_application_usage,public.wp_status_events,public.wp_device_presence to service_role;
revoke all on function public.wp_monitoring_authorize(uuid,uuid,uuid),public.wp_monitoring_device_state(uuid,integer),
  public.wp_monitoring_ingest_one(uuid,uuid,jsonb,jsonb),public.wp_monitoring_batch(uuid,uuid,uuid,text,jsonb,jsonb),
  public.wp_monitoring_status(uuid,uuid,uuid,text,uuid,jsonb),public.wp_core_devices(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wp_monitoring_authorize(uuid,uuid,uuid),public.wp_monitoring_device_state(uuid,integer),
  public.wp_monitoring_ingest_one(uuid,uuid,jsonb,jsonb),public.wp_monitoring_batch(uuid,uuid,uuid,text,jsonb,jsonb),
  public.wp_monitoring_status(uuid,uuid,uuid,text,uuid,jsonb),public.wp_core_devices(uuid,uuid,text,uuid,jsonb) to service_role;

-- SOURCE: migrations/004_processing.proposed.sql
-- REVIEW ONLY: requires approved 001,002,003. No live migration is run automatically.
create table public.wp_app_category_rules (
  id uuid primary key, application_name text not null check(length(application_name) between 1 and 255 and application_name=lower(application_name)),
  category text not null check(category in ('Productive','Neutral','Unproductive')),
  department_id uuid references public.wp_departments(id), created_by uuid not null references public.wp_auth_users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index wp_categories_global_unique on public.wp_app_category_rules(application_name) where department_id is null and deleted_at is null;
create unique index wp_categories_department_unique on public.wp_app_category_rules(application_name,department_id) where department_id is not null and deleted_at is null;
create table public.wp_category_revision(singleton boolean primary key default true check(singleton),revision bigint not null default 0);
insert into public.wp_category_revision(singleton) values(true);
create table public.wp_daily_summaries (
  employee_id uuid not null references public.wp_auth_users(id),summary_date date not null,timezone text not null,
  total_monitored_seconds double precision not null check(total_monitored_seconds>=0),
  active_seconds double precision not null check(active_seconds>=0),idle_seconds double precision not null check(idle_seconds>=0),
  productive_seconds double precision not null check(productive_seconds>=0),neutral_seconds double precision not null check(neutral_seconds>=0),
  unproductive_seconds double precision not null check(unproductive_seconds>=0),unclassified_seconds double precision not null check(unclassified_seconds>=0),
  productivity_score double precision check(productivity_score is null),
  category_revision bigint not null,data jsonb not null,computed_at timestamptz not null default clock_timestamp(),
  primary key(employee_id,summary_date,timezone)
);
create table public.wp_summary_jobs (
  employee_id uuid not null references public.wp_auth_users(id),summary_date date not null,timezone text not null,
  state text not null default 'pending' check(state in ('pending','complete','failed')),
  attempts integer not null default 0 check(attempts>=0),next_retry_at timestamptz,last_error_code text,
  completed_at timestamptz,primary key(employee_id,summary_date,timezone)
);
create index on public.wp_summary_jobs(state,next_retry_at,summary_date);
create table public.wp_summary_schedules(timezone text primary key,last_enqueued_date date not null);

create function public.wp_category_rules(p_actor uuid,p_device uuid,p_session uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; total bigint; dept uuid; page_no integer:=coalesce((p_data->>'page')::integer,1);
  page_size integer:=coalesce((p_data->>'pageSize')::integer,20);
begin
  if p_action='lookup' then
    perform public.wp_monitoring_authorize(p_actor,p_device,p_session);
    select department_id into dept from public.wp_employee_profiles where user_id=p_actor;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.application_name),'[]') into result from (
      select distinct on (r.application_name) r.id,r.application_name,r.category,r.department_id
      from public.wp_app_category_rules r where r.deleted_at is null and (r.department_id is null or r.department_id=dept)
      order by r.application_name,(r.department_id is null)) x;
    return jsonb_build_object('items',result,'categoryRevision',(select revision from public.wp_category_revision where singleton));
  elsif p_action='list' then
    perform public.wp_core_role(p_actor,array['A','M']);
    if page_no<1 or page_size<1 or page_size>100 then raise sqlstate 'PT400' using message='Invalid pagination'; end if;
    with filtered as (select r.* from public.wp_app_category_rules r where r.deleted_at is null
      and (r.department_id is null or public.wp_core_department_visible(p_actor,r.department_id))
      and (p_data->>'departmentId' is null or r.department_id=(p_data->>'departmentId')::uuid)
      and (p_data->>'category' is null or r.category=p_data->>'category')
      and (p_data->>'search' is null or position(lower(p_data->>'search') in r.application_name)>0)),
      paged as (select * from filtered order by application_name,id limit page_size offset (page_no-1)*page_size)
    select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]') into total,result;
    return jsonb_build_object('items',result,'total',total,'page',page_no,'pageSize',page_size);
  end if;
  perform public.wp_core_role(p_actor,array['A']);
  if p_data->>'departmentId' is not null then
    perform 1 from public.wp_departments where id=(p_data->>'departmentId')::uuid and deleted_at is null;
    if not found then raise sqlstate 'PT400' using message='Department unavailable'; end if;
  end if;
  if p_action='create' then
    insert into public.wp_app_category_rules(id,application_name,category,department_id,created_by)
      values(p_id,p_data->>'applicationName',p_data->>'category',(p_data->>'departmentId')::uuid,p_actor);
  elsif p_action='update' then
    update public.wp_app_category_rules set application_name=coalesce(p_data->>'applicationName',application_name),category=coalesce(p_data->>'category',category),
      department_id=case when p_data ? 'departmentId' then (p_data->>'departmentId')::uuid else department_id end,updated_at=now()
      where id=p_id and deleted_at is null;
    if not found then raise sqlstate 'PT404' using message='Application rule not found'; end if;
  elsif p_action='delete' then
    update public.wp_app_category_rules set deleted_at=now(),updated_at=now() where id=p_id and deleted_at is null;
    if not found then raise sqlstate 'PT404' using message='Application rule not found'; end if;
  else raise sqlstate 'PT400' using message='Invalid operation'; end if;
  select to_jsonb(r) into result from public.wp_app_category_rules r where id=p_id;
  return result;
end $$;

create function public.wp_summary_calculate(p_employee uuid,p_date date,p_zone text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare starts timestamptz; ends timestamptz; dept uuid; metrics jsonb; apps jsonb; statuses jsonb; paused float8;
  app_metrics jsonb; revision_value bigint; latest jsonb;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise sqlstate 'PT400' using message='Invalid summary timezone'; end if;
  starts:=p_date::timestamp at time zone p_zone;ends:=(p_date+1)::timestamp at time zone p_zone;
  if ends>clock_timestamp() then raise sqlstate 'PT400' using message='Only closed calendar days can be summarized'; end if;
  if not exists(select 1 from public.wp_auth_users where id=p_employee) then raise sqlstate 'PT404' using message='Employee not found'; end if;
  select department_id into dept from public.wp_employee_profiles where user_id=p_employee;
  select revision into revision_value from public.wp_category_revision where singleton;
  with spans as (
    select a.*,case when interval_end>interval_start then
      extract(epoch from least(interval_end,ends)-greatest(interval_start,starts))/extract(epoch from interval_end-interval_start)
      else 1 end as fraction
    from public.wp_activity_intervals a where employee_id=p_employee and
      ((interval_start<ends and interval_end>starts) or (interval_start=interval_end and interval_start>=starts and interval_start<ends))
  ) select jsonb_build_object('total_monitored_seconds',coalesce(sum(interval_seconds*fraction),0),
    'active_seconds',coalesce(sum(active_seconds*fraction),0),'idle_seconds',coalesce(sum(idle_seconds*fraction),0),
    'source_record_count',count(*),'source_device_count',count(distinct device_id),
    'contains_prorated_intervals',coalesce(bool_or(fraction<1),false),'has_activity_data',count(*)>0) into metrics from spans;
  with spans as (
    select a.device_id,a.record_id,case when interval_end>interval_start then
      extract(epoch from least(interval_end,ends)-greatest(interval_start,starts))/extract(epoch from interval_end-interval_start)
      else 1 end as fraction from public.wp_activity_intervals a where employee_id=p_employee and
      ((interval_start<ends and interval_end>starts) or (interval_start=interval_end and interval_start>=starts and interval_start<ends))
  ), totals as (
    select u.application_name,sum(u.duration_seconds*s.fraction)::float8 as seconds from spans s
      join public.wp_application_usage u on u.device_id=s.device_id and u.record_id=s.record_id group by u.application_name
  ), classified as (
    select t.*, (select category from public.wp_app_category_rules r where r.application_name=t.application_name and r.deleted_at is null
      and (r.department_id is null or r.department_id=dept) order by (r.department_id is null) limit 1) as category from totals t
  ) select coalesce(jsonb_agg(to_jsonb(c) order by application_name),'[]'),jsonb_build_object(
    'productive_seconds',coalesce(sum(seconds) filter(where category='Productive'),0),
    'neutral_seconds',coalesce(sum(seconds) filter(where category='Neutral'),0),
    'unproductive_seconds',coalesce(sum(seconds) filter(where category='Unproductive'),0),
    'unclassified_seconds',coalesce(sum(seconds) filter(where category is null),0),
    'total_application_seconds',coalesce(sum(seconds),0)) into apps,app_metrics from classified c;
  with events as (select status,occurred_at,lead(occurred_at) over(partition by device_id order by occurred_at,record_id) as next_at
    from public.wp_status_events where employee_id=p_employee)
  select coalesce(sum(extract(epoch from least(next_at,ends)-greatest(occurred_at,starts))),0)::float8 into paused
    from events where status='PAUSED' and next_at is not null and occurred_at<ends and next_at>starts;
  select coalesce(jsonb_agg(to_jsonb(x) order by device_id),'[]') into statuses from (
    select distinct on(device_id) device_id,status,occurred_at from public.wp_status_events where employee_id=p_employee and occurred_at<ends
    order by device_id,occurred_at desc,record_id desc) x;
  select jsonb_build_object('device_id',device_id,'status',status,'occurred_at',occurred_at) into latest
    from public.wp_status_events where employee_id=p_employee and occurred_at<ends order by occurred_at desc,record_id desc limit 1;
  return metrics||app_metrics||jsonb_build_object('employee_id',p_employee,'summary_date',p_date,'timezone',p_zone,
    'day_start',starts,'day_end',ends,'calendar_day_seconds',extract(epoch from ends-starts),
    'productivity_score',null,'productivity_score_status','unavailable_pending_business_rule',
    'paused_seconds',null,'reported_paused_seconds',paused,'paused_time_complete',false,
    'paused_time_note','Only bounded explicit PAUSED transitions are measurable; complete heartbeat history is unavailable',
    'applications',apps,'device_statuses_at_day_end',statuses,'latest_reported_status_at_day_end',latest,
    'category_revision',revision_value,'category_scope_basis','current_employee_department_and_current_rules',
    'time_basis','sum_of_device_intervals','allocation_method','proportional_interval_overlap',
    'data_completeness','observed_records_only_late_uploads_may_amend','calculation_version',1);
end $$;

create function public.wp_summary_recalculate(p_employee uuid,p_date date,p_zone text,p_force boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.wp_summary_jobs; data jsonb; code text;
begin
  -- Acquire revision before job locks: category changes use the same lock order.
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone)
    then raise sqlstate 'PT400' using message='Invalid summary timezone';end if;
  if ((p_date+1)::timestamp at time zone p_zone)>clock_timestamp()
    then raise sqlstate 'PT400' using message='Only closed calendar days can be summarized';end if;
  perform 1 from public.wp_category_revision where singleton for share;
  if not exists(select 1 from public.wp_auth_users where id=p_employee) then raise sqlstate 'PT404' using message='Employee not found'; end if;
  insert into public.wp_summary_jobs(employee_id,summary_date,timezone) values(p_employee,p_date,p_zone) on conflict do nothing;
  select * into job from public.wp_summary_jobs where employee_id=p_employee and summary_date=p_date and timezone=p_zone for update;
  if not p_force and job.state='complete' then return jsonb_build_object('state','skipped'); end if;
  begin
    data:=public.wp_summary_calculate(p_employee,p_date,p_zone);
    insert into public.wp_daily_summaries(employee_id,summary_date,timezone,total_monitored_seconds,active_seconds,idle_seconds,
      productive_seconds,neutral_seconds,unproductive_seconds,unclassified_seconds,category_revision,data)
      values(p_employee,p_date,p_zone,(data->>'total_monitored_seconds')::float8,(data->>'active_seconds')::float8,(data->>'idle_seconds')::float8,
      (data->>'productive_seconds')::float8,(data->>'neutral_seconds')::float8,(data->>'unproductive_seconds')::float8,
      (data->>'unclassified_seconds')::float8,(data->>'category_revision')::bigint,data)
      on conflict(employee_id,summary_date,timezone) do update set total_monitored_seconds=excluded.total_monitored_seconds,
        active_seconds=excluded.active_seconds,idle_seconds=excluded.idle_seconds,productive_seconds=excluded.productive_seconds,
        neutral_seconds=excluded.neutral_seconds,unproductive_seconds=excluded.unproductive_seconds,unclassified_seconds=excluded.unclassified_seconds,
        category_revision=excluded.category_revision,data=excluded.data,computed_at=clock_timestamp()
      where wp_daily_summaries.data is distinct from excluded.data;
    update public.wp_summary_jobs set state='complete',attempts=0,next_retry_at=null,last_error_code=null,completed_at=clock_timestamp()
      where employee_id=p_employee and summary_date=p_date and timezone=p_zone;
    return jsonb_build_object('state','complete','summary',data);
  exception when others then
    get stacked diagnostics code=returned_sqlstate;
    update public.wp_summary_jobs set state='failed',attempts=attempts+1,last_error_code=code,
      next_retry_at=clock_timestamp()+make_interval(secs=>60*power(2,least(attempts,6))::integer)
      where employee_id=p_employee and summary_date=p_date and timezone=p_zone;
    return jsonb_build_object('state','failed','error_code',code);
  end;
end $$;

create function public.wp_summary_enqueue(p_zone text,p_start date,p_lookback integer,p_catchup integer,p_delay integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare last_day date; first_day date; cursor_day date; through_day date; n integer;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) or p_lookback not between 1 and 366
    or p_catchup not between 1 and 31 or p_delay not between 0 and 120 then raise sqlstate 'PT400' using message='Invalid summary schedule'; end if;
  last_day:=((clock_timestamp()-make_interval(mins=>p_delay)) at time zone p_zone)::date-1;
  insert into public.wp_summary_schedules(timezone,last_enqueued_date) values(p_zone,coalesce(p_start,last_day-p_lookback+1)-1) on conflict do nothing;
  select last_enqueued_date into cursor_day from public.wp_summary_schedules where timezone=p_zone for update;
  first_day:=cursor_day+1;through_day:=least(last_day,first_day+p_catchup-1);
  insert into public.wp_summary_jobs(employee_id,summary_date,timezone)
    select u.id,d::date,p_zone from generate_series(first_day::timestamp,through_day::timestamp,interval '1 day') d
      cross join public.wp_auth_users u where u.created_at<((d::date+1)::timestamp at time zone p_zone)
      and (u.deleted_at is null or u.deleted_at>(d::date::timestamp at time zone p_zone)) on conflict do nothing;
  get diagnostics n=row_count;
  if through_day>=first_day then update public.wp_summary_schedules set last_enqueued_date=through_day where timezone=p_zone;end if;
  return jsonb_build_object('enqueued',n,'through',through_day);
end $$;

create function public.wp_summary_process(p_zone text,p_limit integer,p_delay integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job record; outcome jsonb; completed integer:=0; failed integer:=0;
begin
  if p_limit not between 1 and 1000 or p_delay not between 0 and 120 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone)
    then raise sqlstate 'PT400' using message='Invalid processing configuration';end if;
  perform 1 from public.wp_category_revision where singleton for share;
  for job in select * from public.wp_summary_jobs where timezone=p_zone and state<>'complete'
    and (next_retry_at is null or next_retry_at<=clock_timestamp())
    and ((summary_date+1)::timestamp at time zone p_zone)<=clock_timestamp()-make_interval(mins=>p_delay)
    order by summary_date,employee_id limit p_limit for update skip locked loop
    outcome:=public.wp_summary_recalculate(job.employee_id,job.summary_date,job.timezone,false);
    if outcome->>'state'='failed' then failed:=failed+1;else completed:=completed+1;end if;
  end loop;
  return jsonb_build_object('completed',completed,'failed',failed);
end $$;

create function public.wp_summary_dirty() returns trigger language plpgsql security invoker set search_path='' as $$
declare zone_row record; local_day date; last_day date; target uuid;
begin
  if tg_table_name='wp_app_category_rules' then
    update public.wp_category_revision set revision=revision+1 where singleton;
    update public.wp_summary_jobs set state='pending',next_retry_at=null,last_error_code=null;
    return new;
  end if;
  if tg_table_name='wp_employee_profiles' then target:=new.user_id;else target:=new.employee_id;end if;
  if tg_table_name in ('wp_status_events','wp_employee_profiles') then
    update public.wp_summary_jobs set state='pending',next_retry_at=null,last_error_code=null where employee_id=target;
  end if;
  if tg_table_name='wp_employee_profiles' then return new;end if;
  for zone_row in select timezone from public.wp_summary_schedules loop
    if tg_table_name='wp_activity_intervals' then
      local_day:=(new.interval_start at time zone zone_row.timezone)::date;
      last_day:=(greatest(new.interval_start,new.interval_end-interval '1 microsecond') at time zone zone_row.timezone)::date;
    else local_day:=(new.occurred_at at time zone zone_row.timezone)::date;last_day:=local_day;end if;
    while local_day<=last_day loop
      insert into public.wp_summary_jobs(employee_id,summary_date,timezone) values(target,local_day,zone_row.timezone)
        on conflict(employee_id,summary_date,timezone) do update set state='pending',next_retry_at=null,last_error_code=null;
      local_day:=local_day+1;
    end loop;
  end loop;
  return new;
end $$;
create trigger wp_category_dirty after insert or update on public.wp_app_category_rules for each row execute function public.wp_summary_dirty();
create trigger wp_interval_dirty after insert on public.wp_activity_intervals for each row execute function public.wp_summary_dirty();
create trigger wp_status_dirty after insert on public.wp_status_events for each row execute function public.wp_summary_dirty();
create trigger wp_department_scope_dirty after update of department_id on public.wp_employee_profiles for each row
  when(old.department_id is distinct from new.department_id) execute function public.wp_summary_dirty();

alter table public.wp_app_category_rules enable row level security;
alter table public.wp_category_revision enable row level security;
alter table public.wp_daily_summaries enable row level security;
alter table public.wp_summary_jobs enable row level security;
alter table public.wp_summary_schedules enable row level security;
create policy wp_categories_deny on public.wp_app_category_rules for all to anon,authenticated using(false) with check(false);
create policy wp_revision_deny on public.wp_category_revision for all to anon,authenticated using(false) with check(false);
create policy wp_summaries_deny on public.wp_daily_summaries for all to anon,authenticated using(false) with check(false);
create policy wp_jobs_deny on public.wp_summary_jobs for all to anon,authenticated using(false) with check(false);
create policy wp_schedules_deny on public.wp_summary_schedules for all to anon,authenticated using(false) with check(false);
revoke all on public.wp_app_category_rules,public.wp_category_revision,public.wp_daily_summaries,public.wp_summary_jobs,public.wp_summary_schedules from public,anon,authenticated;
grant select,insert,update on public.wp_app_category_rules,public.wp_category_revision,public.wp_daily_summaries,public.wp_summary_jobs,public.wp_summary_schedules to service_role;
revoke all on function public.wp_category_rules(uuid,uuid,uuid,text,uuid,jsonb),public.wp_summary_calculate(uuid,date,text),
  public.wp_summary_recalculate(uuid,date,text,boolean),public.wp_summary_enqueue(text,date,integer,integer,integer),
  public.wp_summary_process(text,integer,integer),public.wp_summary_dirty() from public,anon,authenticated;
grant execute on function public.wp_category_rules(uuid,uuid,uuid,text,uuid,jsonb),public.wp_summary_calculate(uuid,date,text),
  public.wp_summary_recalculate(uuid,date,text,boolean),public.wp_summary_enqueue(text,date,integer,integer,integer),
  public.wp_summary_process(text,integer,integer),public.wp_summary_dirty() to service_role;

-- SOURCE: migrations/005_analytics.proposed.sql
-- REVIEW ONLY: requires approved proposals 001-004; never automatically applied.
create index wp_intervals_employee_end on public.wp_activity_intervals(employee_id,interval_end);
create index wp_status_employee_latest on public.wp_status_events(employee_id,occurred_at desc);

create function public.wp_analytics_intervals(p_actor uuid,p_target uuid,p_dept uuid,p_start timestamptz,p_end timestamptz)
returns table(employee_id uuid,device_id uuid,record_id uuid,interval_start timestamptz,interval_end timestamptz,
  active_seconds float8,idle_seconds float8,interval_seconds float8,mouse_movements bigint,mouse_clicks bigint,key_presses bigint,status text,fraction float8)
language sql stable security invoker set search_path='' as $$
select a.employee_id,a.device_id,a.record_id,a.interval_start,a.interval_end,a.active_seconds,a.idle_seconds,a.interval_seconds,
  a.mouse_movements,a.mouse_clicks,a.key_presses,a.summary->>'status',
  case when a.interval_end>a.interval_start then (extract(epoch from least(a.interval_end,p_end)-greatest(a.interval_start,p_start))/extract(epoch from a.interval_end-a.interval_start))::float8 else 1::float8 end
from public.wp_activity_intervals a join public.wp_employee_profiles p on p.user_id=a.employee_id
where public.wp_core_can_read(p_actor,a.employee_id) and (p_target is null or a.employee_id=p_target)
  and (p_dept is null or p.department_id=p_dept)
  and ((a.interval_start<p_end and a.interval_end>p_start) or (a.interval_start=a.interval_end and a.interval_start>=p_start and a.interval_start<p_end))
$$;
create function public.wp_analytics_apps(p_actor uuid,p_target uuid,p_dept uuid,p_start timestamptz,p_end timestamptz)
returns table(employee_id uuid,application_name text,category text,seconds float8)
language sql stable security invoker set search_path='' as $$
select a.employee_id,u.application_name,
  (select r.category from public.wp_app_category_rules r where r.application_name=u.application_name and r.deleted_at is null
    and (r.department_id is null or r.department_id=p.department_id) order by (r.department_id is null) limit 1),
  u.duration_seconds*a.fraction
from public.wp_analytics_intervals(p_actor,p_target,p_dept,p_start,p_end) a
join public.wp_application_usage u on u.device_id=a.device_id and u.record_id=a.record_id
join public.wp_employee_profiles p on p.user_id=a.employee_id
$$;
create function public.wp_analytics_live(p_actor uuid,p_dept uuid,p_timeout integer)
returns table(id uuid,email text,first_name text,last_name text,department_id uuid,department_name text,status text,last_seen timestamptz)
language sql stable security invoker set search_path='' as $$
select e.id,e.email,e.first_name,e.last_name,e.department_id,e.department_name,
  case when not e.is_active then 'OFFLINE' when bool_or(s.value->>'effectiveStatus'='ACTIVE') then 'ACTIVE'
    when bool_or(s.value->>'effectiveStatus'='IDLE') then 'IDLE' when bool_or(s.value->>'effectiveStatus'='PAUSED') then 'PAUSED'
    when bool_or(s.value->>'connectionState'='ONLINE') then 'UNKNOWN' else 'OFFLINE' end,
  max(d.last_seen)
from public.wp_core_employees e left join public.wp_auth_devices d on d.user_id=e.id and d.deleted_at is null
left join lateral (select case when d.id is not null then public.wp_monitoring_device_state(d.id,p_timeout) else null end value) s on true
where e.deleted_at is null and public.wp_core_can_read(p_actor,e.id) and (p_dept is null or e.department_id=p_dept)
group by e.id,e.email,e.first_name,e.last_name,e.department_id,e.department_name,e.is_active
$$;

create function public.wp_analytics(p_actor uuid,p_device uuid,p_session uuid,p_action text,p_target uuid,p_options jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare zone text:=p_options->>'timezone';starts timestamptz;ends timestamptz;dept uuid:=(p_options->>'departmentId')::uuid;
  page_no integer:=coalesce((p_options->>'page')::integer,1);size integer:=coalesce((p_options->>'pageSize')::integer,20);
  result jsonb;total bigint;bucket record;items jsonb:='[]';metrics jsonb;app_total float8;timeout integer:=(p_options->>'offlineTimeoutSeconds')::integer;
begin
  if p_action in ('own','own-summary') then
    if p_target is distinct from p_actor then raise sqlstate 'PT403' using message='Own employee context required';end if;
    if p_device is not null then
      if p_action<>'own-summary' then raise sqlstate 'PT403' using message='Forbidden';end if;
      perform public.wp_monitoring_authorize(p_actor,p_device,p_session);
    else perform public.wp_core_role(p_actor,array['E']);end if;
  else perform public.wp_core_role(p_actor,array['A','M']);end if;
  if p_target is not null and not exists(select 1 from public.wp_auth_users where id=p_target and deleted_at is null and public.wp_core_can_read(p_actor,id))
    then raise sqlstate 'PT404' using message='Employee not found';end if;
  if dept is not null and not exists(select 1 from public.wp_departments where id=dept and deleted_at is null and public.wp_core_department_visible(p_actor,id))
    then raise sqlstate 'PT404' using message='Department not found';end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) or page_no<1 or size<1 or size>100
    then raise sqlstate 'PT400' using message='Invalid analytics filters';end if;
  starts:=(p_options->>'from')::date::timestamp at time zone zone;
  ends:=((p_options->>'to')::date+1)::timestamp at time zone zone;
  if ends<=starts or ends-starts>interval '367 days' then raise sqlstate 'PT400' using message='Invalid analytics range';end if;

  if p_action in ('summary','own-summary') then
    select jsonb_build_object('total_monitored_seconds',coalesce(sum(interval_seconds*fraction),0),'active_seconds',coalesce(sum(active_seconds*fraction),0),
      'idle_seconds',coalesce(sum(idle_seconds*fraction),0),'record_count',count(*),'productivity_score',null,'paused_seconds',null,
      'time_basis','sum_of_device_intervals','allocation_method','proportional_interval_overlap') into result
      from public.wp_analytics_intervals(p_actor,p_target,dept,starts,ends);
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into metrics from (
      select application_name,category,sum(seconds) as seconds from public.wp_analytics_apps(p_actor,p_target,dept,starts,ends) group by application_name,category order by application_name) x;
    return jsonb_build_object('data',result||jsonb_build_object('applications',metrics));
  elsif p_action in ('activity','own','log') then
    with filtered as (select * from public.wp_analytics_intervals(p_actor,p_target,dept,starts,ends) a
      where (p_options->>'status' is null or a.status=p_options->>'status') and
      (p_options->>'applicationName' is null or exists(select 1 from public.wp_application_usage u where u.device_id=a.device_id and u.record_id=a.record_id and u.application_name=p_options->>'applicationName'))),
      paged as (select * from filtered order by interval_start desc,record_id,device_id limit size offset (page_no-1)*size)
    select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]') into total,result;
  elsif p_action in ('timeline','trend','active-vs-idle','app-trend') then
    for bucket in select g as b,least(g+case when p_action='timeline' then interval '1 hour' else interval '1 day' end,ends) as e
      from generate_series(starts,ends-interval '1 microsecond',case when p_action='timeline' then interval '1 hour' else interval '1 day' end) g loop
      -- Calendar day stepping uses explicit local dates, not fixed 24-hour offsets.
      if p_action<>'timeline' then exit;end if;
      select jsonb_build_object('timestamp',bucket.b,'label',to_char(bucket.b at time zone zone,'HH24:MI'),
        'active_seconds',coalesce(sum(active_seconds*fraction),0),'idle_seconds',coalesce(sum(idle_seconds*fraction),0)) into metrics
        from public.wp_analytics_intervals(p_actor,p_target,dept,bucket.b,bucket.e);
      items:=items||jsonb_build_array(metrics);
    end loop;
    if p_action<>'timeline' then
      for bucket in select d::date as day,d::timestamp at time zone zone as b,(d::date+1)::timestamp at time zone zone as e
        from generate_series((p_options->>'from')::date::timestamp,(p_options->>'to')::date::timestamp,interval '1 day') d loop
        if p_action='app-trend' then
          select jsonb_build_object('date',bucket.day,'productive_seconds',coalesce(sum(seconds) filter(where category='Productive'),0),
            'neutral_seconds',coalesce(sum(seconds) filter(where category='Neutral'),0),'unproductive_seconds',coalesce(sum(seconds) filter(where category='Unproductive'),0),
            'unclassified_seconds',coalesce(sum(seconds) filter(where category is null),0)) into metrics
            from public.wp_analytics_apps(p_actor,p_target,dept,bucket.b,bucket.e);
        else
          select jsonb_build_object('date',bucket.day,'active_seconds',coalesce(sum(active_seconds*fraction),0),'idle_seconds',coalesce(sum(idle_seconds*fraction),0)) into metrics
            from public.wp_analytics_intervals(p_actor,p_target,dept,bucket.b,bucket.e);
        end if;
        items:=items||jsonb_build_array(metrics);
      end loop;
    end if;
    return jsonb_build_object('data',items);
  elsif p_action in ('apps','top','export') then
    if p_action='top' then size:=10;page_no:=1;elsif p_action='export' then size:=10000;page_no:=1;end if;
    with totals as (select application_name,sum(seconds) as seconds,count(distinct employee_id) as users,
      case when count(distinct category)=1 and count(*) filter(where category is null)=0 then min(category) else null end as category
      from public.wp_analytics_apps(p_actor,p_target,dept,starts,ends) group by application_name),
      paged as (select * from totals order by seconds desc,application_name limit size offset (page_no-1)*size)
    select (select count(*) from totals),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]') into total,result;
    if p_action='export' and total>10000 then raise sqlstate 'PT413' using message='Narrow export to 10000 applications';end if;
  elsif p_action='breakdown' then
    select coalesce(sum(seconds),0) into app_total from public.wp_analytics_apps(p_actor,p_target,dept,starts,ends);
    select jsonb_agg(jsonb_build_object('category',c.name,'seconds',coalesce(t.seconds,0),
      'percentage',case when app_total=0 then null else coalesce(t.seconds,0)*100/app_total end)) into result
      from (values('Productive'),('Neutral'),('Unproductive'),('Unclassified')) c(name)
      left join (select coalesce(category,'Unclassified') category,sum(seconds) seconds from public.wp_analytics_apps(p_actor,p_target,dept,starts,ends) group by category) t on t.category=c.name;
    return jsonb_build_object('data',jsonb_build_object('items',result,'total_application_seconds',app_total,'percentage_basis','all_recorded_application_duration','productivity_score',null));
  elsif p_action='stats' then
    select jsonb_build_object('total_employees',count(*),'active',count(*) filter(where status='ACTIVE'),'idle',count(*) filter(where status='IDLE'),
      'paused',count(*) filter(where status='PAUSED'),'offline',count(*) filter(where status='OFFLINE'),'unknown',count(*) filter(where status='UNKNOWN')) into result
      from public.wp_analytics_live(p_actor,dept,timeout);
    return jsonb_build_object('data',result);
  elsif p_action='live' then
    with filtered as (select * from public.wp_analytics_live(p_actor,dept,timeout) l where
      (p_options->>'status' is null or l.status=p_options->>'status') and
      (p_options->>'search' is null or position(lower(p_options->>'search') in lower(l.email||' '||l.first_name||' '||l.last_name))>0)),
      paged as (select * from filtered order by id limit size offset (page_no-1)*size)
    select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]') into total,result;
  elsif p_action='departments' then
    with totals as (select p.department_id,sum(a.active_seconds*a.fraction) active_seconds,sum(a.idle_seconds*a.fraction) idle_seconds,
      sum(a.interval_seconds*a.fraction) total_monitored_seconds from public.wp_analytics_intervals(p_actor,p_target,dept,starts,ends) a
      join public.wp_employee_profiles p on p.user_id=a.employee_id group by p.department_id),
    visible as (select d.id,d.name,coalesce(t.active_seconds,0) active_seconds,coalesce(t.idle_seconds,0) idle_seconds,
      coalesce(t.total_monitored_seconds,0) total_monitored_seconds,null::float8 productivity_score
      from public.wp_departments d left join totals t on t.department_id=d.id where d.deleted_at is null
        and public.wp_core_department_visible(p_actor,d.id) and (dept is null or d.id=dept)),
    paged as(select * from visible order by name,id limit size offset (page_no-1)*size)
    select (select count(*) from visible),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]') into total,result;
  else raise sqlstate 'PT400' using message='Unknown analytics operation';end if;
  return jsonb_build_object('data',result,'pagination',jsonb_build_object('page',page_no,'pageSize',size,'total',total,'totalPages',ceil(total::numeric/size)));
end $$;
revoke all on function public.wp_analytics_intervals(uuid,uuid,uuid,timestamptz,timestamptz),public.wp_analytics_apps(uuid,uuid,uuid,timestamptz,timestamptz),
  public.wp_analytics_live(uuid,uuid,integer),public.wp_analytics(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wp_analytics_intervals(uuid,uuid,uuid,timestamptz,timestamptz),public.wp_analytics_apps(uuid,uuid,uuid,timestamptz,timestamptz),
  public.wp_analytics_live(uuid,uuid,integer),public.wp_analytics(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

-- SOURCE: migrations/006_reports.proposed.sql
-- REVIEW ONLY; requires approved 001-005. Never run automatically.
create table public.wp_report_exports (
  id uuid primary key,requested_user uuid not null references public.wp_auth_users(id),
  export_type text not null check(export_type in ('csv','pdf')),report_type text not null check(report_type in ('summary','activity','application-usage')),
  period_from date not null,period_to date not null,timezone text not null,
  filename text not null check(filename !~ '[/\\]'),file_bytes bigint not null check(file_bytes>=0),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),row_count integer not null check(row_count>=0),
  employee_ids uuid[] not null,generated_at timestamptz not null default clock_timestamp(),check(period_to>=period_from)
);
create index on public.wp_report_exports(requested_user,generated_at desc);

create function public.wp_reports(p_actor uuid,p_session uuid,p_action text,p_options jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target uuid:=(p_options->>'employeeId')::uuid;dept uuid:=(p_options->>'departmentId')::uuid;
  zone text:=p_options->>'timezone';starts timestamptz;ends timestamptz;validation jsonb;result jsonb;total bigint;
  page_no integer:=coalesce((p_options->>'page')::integer,1);size integer:=coalesce((p_options->>'pageSize')::integer,20);
  kind text:=coalesce(p_options->>'reportType','summary');kpis jsonb;
begin
  perform public.wp_core_role(p_actor,array['A','M']);
  if p_action='history' then
    with visible as(select x.* from public.wp_report_exports x where x.requested_user=p_actor
      and not exists(select 1 from unnest(x.employee_ids) e where not public.wp_core_can_read(p_actor,e))),
      paged as(select id,export_type,report_type,period_from,period_to,timezone,filename,file_bytes,sha256,row_count,generated_at
        from visible order by generated_at desc,id limit size offset (page_no-1)*size)
    select (select count(*) from visible),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]') into total,result;
    return jsonb_build_object('data',result,'pagination',jsonb_build_object('page',page_no,'pageSize',size,'total',total,'totalPages',ceil(total::numeric/size)));
  end if;
  validation:=public.wp_analytics(p_actor,null,p_session,'summary',target,p_options);
  kpis:=validation->'data';
  if p_action='kpis' then return jsonb_build_object('data',kpis||jsonb_build_object('attendance_rate',null,'overtime_seconds',null));end if;
  if p_action='charts' then return jsonb_build_object('data',jsonb_build_object(
    'active_vs_idle',public.wp_analytics(p_actor,null,p_session,'trend',target,p_options)->'data',
    'application_categories',public.wp_analytics(p_actor,null,p_session,'breakdown',target,p_options)->'data',
    'departments',public.wp_analytics(p_actor,null,p_session,'departments',target,p_options)->'data'));end if;
  starts:=(p_options->>'from')::date::timestamp at time zone zone;ends:=((p_options->>'to')::date+1)::timestamp at time zone zone;
  if kind not in ('summary','activity','application-usage') then raise sqlstate 'PT400' using message='Invalid report type';end if;
  if p_action='export' then size:=(p_options->>'maxRows')::integer;page_no:=1;
    if size not between 1 and 10000 then raise sqlstate 'PT400' using message='Invalid export limit';end if;
  end if;
  with scoped as(select e.* from public.wp_core_employees e where e.deleted_at is null and public.wp_core_can_read(p_actor,e.id)
    and (target is null or e.id=target) and (dept is null or e.department_id=dept)),
  intervals as(select * from public.wp_analytics_intervals(p_actor,target,dept,starts,ends)),
  duration as(select employee_id,sum(interval_seconds*fraction) monitored,sum(active_seconds*fraction) active,sum(idle_seconds*fraction) idle
    from intervals group by employee_id),
  apps as(select * from public.wp_analytics_apps(p_actor,target,dept,starts,ends)),
  classified as(select employee_id,sum(seconds) filter(where category='Productive') productive,sum(seconds) filter(where category='Neutral') neutral,
    sum(seconds) filter(where category='Unproductive') unproductive,sum(seconds) filter(where category is null) unclassified from apps group by employee_id),
  app_totals as(select employee_id,application_name,category,sum(seconds) seconds from apps group by employee_id,application_name,category),
  ranked as(select *,row_number() over(partition by employee_id order by seconds desc,application_name) rank from app_totals),
  observed as(select i.employee_id,count(distinct d::date) days from intervals i
    cross join lateral generate_series((greatest(i.interval_start,starts) at time zone zone)::date::timestamp,
      (greatest(greatest(i.interval_start,starts),least(i.interval_end,ends)-interval '1 microsecond') at time zone zone)::date::timestamp,interval '1 day') d
    where i.interval_seconds>0 group by i.employee_id),
  summary_rows as(select e.id employee_id,e.employee_code,trim(e.first_name||' '||e.last_name) employee_name,e.email,e.role,e.department_name,
    coalesce(d.monitored,0) total_monitored_seconds,coalesce(d.active,0) active_seconds,coalesce(d.idle,0) idle_seconds,
    coalesce(c.productive,0) productive_seconds,coalesce(c.neutral,0) neutral_seconds,coalesce(c.unproductive,0) unproductive_seconds,
    coalesce(c.unclassified,0) unclassified_seconds,null::float8 productivity_score,coalesce(o.days,0) observed_activity_days,r.application_name top_application
    from scoped e left join duration d on d.employee_id=e.id left join classified c on c.employee_id=e.id
    left join observed o on o.employee_id=e.id left join ranked r on r.employee_id=e.id and r.rank=1),
  rows as(
    select e.id sort_employee,e.id::text sort_record,to_jsonb(s) value from summary_rows s join scoped e on e.id=s.employee_id where kind='summary'
    union all select e.id,i.record_id::text,jsonb_build_object('employee_id',e.id,'employee_name',trim(e.first_name||' '||e.last_name),
      'department_name',e.department_name,'record_id',i.record_id,'device_id',i.device_id,'interval_start',i.interval_start,'interval_end',i.interval_end,
      'total_monitored_seconds',i.interval_seconds*i.fraction,'active_seconds',i.active_seconds*i.fraction,'idle_seconds',i.idle_seconds*i.fraction,'interval_fraction',i.fraction)
      from intervals i join scoped e on e.id=i.employee_id where kind='activity'
    union all select e.id,a.application_name||coalesce(a.category,''),jsonb_build_object('employee_id',e.id,'employee_name',trim(e.first_name||' '||e.last_name),
      'department_name',e.department_name,'application_name',a.application_name,'category',a.category,'duration_seconds',a.seconds)
      from app_totals a join scoped e on e.id=a.employee_id where kind='application-usage'),
  paged as(select * from rows order by sort_employee,sort_record limit size offset (page_no-1)*size)
  select (select count(*) from rows),coalesce((select jsonb_agg(value) from paged),'[]') into total,result;
  if p_action='export' and total>size then raise sqlstate 'PT413' using message='Narrow report filters; export exceeds row limit';end if;
  return jsonb_build_object('data',result,'kpis',kpis,'pagination',jsonb_build_object('page',page_no,'pageSize',size,'total',total,'totalPages',ceil(total::numeric/size)),
    'scope',jsonb_build_object('employee',(select trim(first_name||' '||last_name) from public.wp_core_employees where id=target),
      'department',(select name from public.wp_departments where id=dept)));
end $$;

create function public.wp_report_export_record(p_actor uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ids uuid[];result jsonb;
begin
  perform public.wp_core_role(p_actor,array['A','M']);
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(p_data->'employeeIds');
  if exists(select 1 from unnest(ids) e where not public.wp_core_can_read(p_actor,e)) then raise sqlstate 'PT403' using message='Export scope changed';end if;
  insert into public.wp_report_exports(id,requested_user,export_type,report_type,period_from,period_to,timezone,filename,file_bytes,sha256,row_count,employee_ids)
    values((p_data->>'id')::uuid,p_actor,p_data->>'type',p_data->>'reportType',(p_data->>'from')::date,(p_data->>'to')::date,p_data->>'timezone',
      p_data->>'filename',(p_data->>'bytes')::bigint,p_data->>'sha256',(p_data->>'rowCount')::integer,ids) returning
      jsonb_build_object('id',id,'generated_at',generated_at) into result;
  return result;
end $$;
alter table public.wp_report_exports enable row level security;
create policy wp_exports_deny on public.wp_report_exports for all to anon,authenticated using(false) with check(false);
revoke all on public.wp_report_exports from public,anon,authenticated;
grant select,insert on public.wp_report_exports to service_role;
revoke all on function public.wp_reports(uuid,uuid,text,jsonb),public.wp_report_export_record(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wp_reports(uuid,uuid,text,jsonb),public.wp_report_export_record(uuid,jsonb) to service_role;

-- SOURCE: migrations/007_system.proposed.sql
-- REVIEW ONLY. Requires 001-006; do not apply to production without approval.
-- Custom JWTs are checked by Express; only the server service role may call RPCs.
create table public.wp_system_settings(
  section text primary key check(section in ('monitoring','workingHours','retention','notifications')),
  value jsonb not null check(jsonb_typeof(value)='object'),revision bigint not null default 1,
  updated_by uuid references public.wp_auth_users(id),updated_at timestamptz not null default now()
);
-- No schedule/timezone is silently provisioned. Configure the authorized schedule before use.
insert into public.wp_system_settings(section,value) values
 ('monitoring','{"idleMinutes":5,"evaluationSeconds":60,"syncMinutes":5,"offlineDays":7,"trackApplications":true,"trackKeyboardCounts":true,"trackMouseCounts":true,"pauseOutsideHours":true}'),
 ('workingHours','{"timezone":null,"schedule":null,"configured":false}'),
 ('retention','{"retentionDays":90,"requireConsent":true}'),
 ('notifications','{"notifyIdle":true,"notifyAgentOffline":true,"weeklyDigest":false}');
create table public.wp_notifications(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.wp_auth_users(id),
 type text not null check(type in ('settings','device-offline','idle')),message text not null,
 created_at timestamptz not null default now(),read_at timestamptz,deleted_at timestamptz
);
create index wp_notifications_owner_date on public.wp_notifications(user_id,created_at desc) where deleted_at is null;
create table public.wp_audit_logs(
 id uuid primary key default gen_random_uuid(),actor_id uuid references public.wp_auth_users(id),
 action text not null,resource text not null,resource_id text,created_at timestamptz not null default now()
);
create index wp_audit_date on public.wp_audit_logs(created_at desc);
create index wp_audit_actor_date on public.wp_audit_logs(actor_id,created_at desc);
create table public.wp_realtime_events(
 seq bigserial primary key,event_name text not null check(event_name in ('employee:status','dashboard:stats','activity:update','device:online','device:offline','notification:new','settings:updated')),
 employee_id uuid,user_id uuid,device_id uuid,payload jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.wp_device_connectivity(device_id uuid primary key references public.wp_auth_devices(id),online boolean not null,changed_at timestamptz not null default now());

-- Serialize sequence allocation with commit order, so a cursor cannot skip an
-- earlier uncommitted event when concurrent HTTP transactions finish out of order.
create function public.wp_system_event_order() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(807008);
 new.seq:=nextval('public.wp_realtime_events_seq_seq');return new;
end $$;
create trigger wp_event_order before insert on public.wp_realtime_events for each row execute function public.wp_system_event_order();

create function public.wp_system(p_actor uuid,p_device uuid,p_session uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare section_name text;v jsonb;result jsonb;total bigint;limit_rows integer:=coalesce((p_data->>'pageSize')::integer,25);page_number integer:=coalesce((p_data->>'page')::integer,1);changed integer;
begin
 if p_device is not null then
   perform public.wp_monitoring_authorize(p_actor,p_device,p_session);
   if p_action not in ('working-hours','agent-authorize') then raise sqlstate 'PT403';end if;
 else perform public.wp_core_role(p_actor,case when p_action in ('notifications','read-all','read','delete-notification') then array['A','M','E'] else array['A'] end);end if;
 if p_action='agent-authorize' then return jsonb_build_object('data',true);end if;
 if limit_rows<1 or limit_rows>100 or page_number<1 or page_number>100000 then raise sqlstate 'PT400';end if;
 if p_action='settings' then
   select jsonb_object_agg(section,value||jsonb_build_object('revision',revision)) into result from public.wp_system_settings;
   return jsonb_build_object('data',result);
 elsif p_action='working-hours' then return jsonb_build_object('data',(select value||jsonb_build_object('revision',revision) from public.wp_system_settings where section='workingHours'));
 elsif p_action='roles' then return jsonb_build_object('data',jsonb_build_array(
   jsonb_build_object('role','A','name','Admin','scope','organization','permissions',jsonb_build_array('employees.manage','departments.manage','devices.manage','reports.read','settings.manage','audit.read')),
   jsonb_build_object('role','M','name','Manager','scope','assigned employees and managed departments','permissions',jsonb_build_array('employees.read.scoped','departments.read.scoped','activity.read.scoped','reports.read.scoped')),
   jsonb_build_object('role','E','name','Employee','scope','self','permissions',jsonb_build_array('profile.manage.self','activity.read.self','consent.accept')),
   jsonb_build_object('role','Agent','name','Desktop Agent','scope','registered device and associated employee','permissions',jsonb_build_array('activity.submit.device','device.heartbeat.self','settings.working-hours.read','agent.release.read'))));
 elsif p_action in ('monitoring','working-hours-write','data-retention','notification-settings') then
   section_name:=case p_action when 'monitoring' then 'monitoring' when 'working-hours-write' then 'workingHours' when 'data-retention' then 'retention' else 'notifications' end;
   if p_action='data-retention' and p_data->>'requireConsent'='false' then raise sqlstate 'PT400';end if;
   if p_action='working-hours-write' then
     if not (p_data ? 'schedule' and p_data ? 'timezone') then raise sqlstate 'PT400';end if;
     perform now() at time zone (p_data->>'timezone');p_data:=p_data||'{"configured":true}';
   end if;
   update public.wp_system_settings set value=value||p_data,revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
     where section=section_name and not value @> p_data returning value||jsonb_build_object('revision',revision) into v;
   if found then
     insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values(p_actor,'settings.update','settings',section_name);
     insert into public.wp_realtime_events(event_name,payload) values('settings:updated',jsonb_build_object('section',section_name,'revision',v->'revision'));
     insert into public.wp_notifications(user_id,type,message) values(p_actor,'settings','Organization settings were updated.');
   else select value||jsonb_build_object('revision',revision) into v from public.wp_system_settings where section=section_name;end if;
   return jsonb_build_object('data',v);
 elsif p_action='notifications' then
   select count(*) into total from public.wp_notifications where user_id=p_actor and deleted_at is null;
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select id,type,message,created_at,read_at from public.wp_notifications where user_id=p_actor and deleted_at is null order by created_at desc,id limit limit_rows offset (page_number-1)*limit_rows)x;
 elsif p_action in ('read','read-all','delete-notification') then
   update public.wp_notifications set read_at=case when p_action in ('read','read-all') then coalesce(read_at,clock_timestamp()) else read_at end,
    deleted_at=case when p_action='delete-notification' then clock_timestamp() else deleted_at end
    where user_id=p_actor and deleted_at is null and (p_action='read-all' or id=p_id);
   get diagnostics changed=row_count;
   if p_action<>'read-all' and changed=0 then raise sqlstate 'PT404';end if;
   return jsonb_build_object('data',jsonb_build_object('affected',changed));
 elsif p_action in ('audit','audit-export') then
   if p_data ? 'from' and p_data ? 'to' and (p_data->>'from')::timestamptz>(p_data->>'to')::timestamptz then raise sqlstate 'PT400';end if;
   select count(*) into total from public.wp_audit_logs a where
    (not p_data ? 'actorId' or a.actor_id=(p_data->>'actorId')::uuid) and (not p_data ? 'action' or a.action=p_data->>'action') and (not p_data ? 'resource' or a.resource=p_data->>'resource')
    and (not p_data ? 'from' or a.created_at>=(p_data->>'from')::timestamptz) and (not p_data ? 'to' or a.created_at<=(p_data->>'to')::timestamptz);
   if p_action='audit-export' and total>10000 then raise sqlstate 'PT413';end if;
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select a.* from public.wp_audit_logs a where
    (not p_data ? 'actorId' or a.actor_id=(p_data->>'actorId')::uuid) and (not p_data ? 'action' or a.action=p_data->>'action') and (not p_data ? 'resource' or a.resource=p_data->>'resource')
    and (not p_data ? 'from' or a.created_at>=(p_data->>'from')::timestamptz) and (not p_data ? 'to' or a.created_at<=(p_data->>'to')::timestamptz)
    order by created_at desc,id limit case when p_action='audit-export' then 10000 else limit_rows end offset case when p_action='audit-export' then 0 else (page_number-1)*limit_rows end)x;
 else raise sqlstate 'PT400';end if;
 return jsonb_build_object('data',result,'pagination',jsonb_build_object('total',total,'page',page_number,'pageSize',limit_rows));
end $$;

-- Transactional triggers expose identifiers/status only, never arbitrary row contents.
create function public.wp_system_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='wp_activity_intervals' then
   insert into public.wp_realtime_events(event_name,employee_id,device_id,payload) values('activity:update',new.employee_id,new.device_id,jsonb_build_object('record_id',new.record_id,'employee_id',new.employee_id,'device_id',new.device_id));
 elsif tg_table_name='wp_status_events' then
   insert into public.wp_realtime_events(event_name,employee_id,device_id,payload) values
    ('employee:status',new.employee_id,new.device_id,jsonb_build_object('employee_id',new.employee_id,'device_id',new.device_id,'status',new.status,'occurred_at',new.occurred_at)),
    ('dashboard:stats',new.employee_id,new.device_id,'{}');
   if new.status='IDLE' and not exists(select 1 from public.wp_device_presence where device_id=new.device_id and reported_status='IDLE')
     and (select (value->>'notifyIdle')::boolean from public.wp_system_settings where section='notifications') then
     insert into public.wp_notifications(user_id,type,message) select u.id,'idle','An authorized employee device reported idle status.' from public.wp_auth_users u
       where u.is_active and u.deleted_at is null and u.role in ('A','M') and public.wp_core_can_read(u.id,new.employee_id);
   end if;
 elsif tg_table_name='wp_auth_users' then
   insert into public.wp_realtime_events(event_name,employee_id,payload) values('dashboard:stats',new.id,'{}');
 elsif tg_table_name='wp_notifications' then
   insert into public.wp_realtime_events(event_name,user_id,payload) values('notification:new',new.user_id,jsonb_build_object('id',new.id,'type',new.type,'message',new.message,'created_at',new.created_at));
 end if;
 return new;
end $$;
create trigger wp_activity_live after insert on public.wp_activity_intervals for each row execute function public.wp_system_change();
create trigger wp_status_live after insert on public.wp_status_events for each row execute function public.wp_system_change();
create trigger wp_notification_live after insert on public.wp_notifications for each row execute function public.wp_system_change();
create trigger wp_user_live after insert or update of is_active,deleted_at,role on public.wp_auth_users for each row execute function public.wp_system_change();

create function public.wp_system_events(p_after bigint,p_timeout integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d record;previous boolean;is_online boolean;tail bigint;events jsonb;
begin
 if p_timeout<30 or p_timeout>86400 then raise sqlstate 'PT400';end if;
 -- Serialize sweepers across API instances. Every instance still reads the same outbox.
 perform pg_advisory_xact_lock(807008);
 for d in select x.id,x.user_id,x.last_seen,x.is_active,x.deleted_at,x.registered_at,u.is_active as user_active,u.deleted_at as user_deleted from public.wp_auth_devices x join public.wp_auth_users u on u.id=x.user_id loop
   is_online:=coalesce(d.registered_at is not null and d.is_active and d.deleted_at is null and d.user_active and d.user_deleted is null and d.last_seen>clock_timestamp()-make_interval(secs=>p_timeout),false);
   select online into previous from public.wp_device_connectivity where device_id=d.id;
   if not found then
     insert into public.wp_device_connectivity(device_id,online) values(d.id,is_online);
     -- Establish baseline without inventing a transition for previously offline devices.
     if not is_online then continue;end if;
   elsif previous=is_online then continue;
   else update public.wp_device_connectivity set online=is_online,changed_at=clock_timestamp() where device_id=d.id;end if;
   insert into public.wp_realtime_events(event_name,employee_id,device_id,payload) values
    (case when is_online then 'device:online' else 'device:offline' end,d.user_id,d.id,jsonb_build_object('device_id',d.id,'employee_id',d.user_id,'connectionState',case when is_online then 'ONLINE' else 'OFFLINE' end)),
    ('employee:status',d.user_id,d.id,jsonb_build_object('employee_id',d.user_id,'device_id',d.id,'effectiveStatus',public.wp_monitoring_device_state(d.id,p_timeout)->'effectiveStatus')),
    ('dashboard:stats',d.user_id,d.id,'{}');
   if not is_online and (select (value->>'notifyAgentOffline')::boolean from public.wp_system_settings where section='notifications') then
     insert into public.wp_notifications(user_id,type,message) select u.id,'device-offline','An authorized desktop device went offline.' from public.wp_auth_users u
       where u.is_active and u.deleted_at is null and u.role in ('A','M') and public.wp_core_can_read(u.id,d.user_id);
   end if;
 end loop;
 select coalesce(max(seq),0) into tail from public.wp_realtime_events;
 if p_after is null then return jsonb_build_object('cursor',tail,'events','[]'::jsonb);end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by seq),'[]') into events from (select * from public.wp_realtime_events where seq>p_after order by seq limit 200)x;
 return jsonb_build_object('cursor',coalesce((events->-1->>'seq')::bigint,p_after),'events',events);
end $$;

create function public.wp_system_event_visible(p_actor uuid,p_device uuid,p_session uuid,p_event jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare role_name text;
begin
 if p_device is not null then perform public.wp_monitoring_authorize(p_actor,p_device,p_session);return p_event->>'event_name'='settings:updated';end if;
 role_name:=public.wp_core_role(p_actor,array['A','M','E']);
 if p_event->>'event_name'='notification:new' then return (p_event->>'user_id')::uuid=p_actor;end if;
 if p_event->>'event_name'='settings:updated' then return false;end if;
 if role_name not in ('A','M') then return false;end if;
 return p_event->>'employee_id' is not null and public.wp_core_can_read(p_actor,(p_event->>'employee_id')::uuid);
end $$;

-- Audit successful administrative RPCs, in the same transaction as each mutation.
alter function public.wp_core_employee_write(uuid,text,uuid,jsonb) rename to wp_core_employee_write_before_system;
create function public.wp_core_employee_write(p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 result:=public.wp_core_employee_write_before_system(p_actor,p_action,p_id,p_data);
 if p_action='bulk-deactivate' then
  insert into public.wp_audit_logs(actor_id,action,resource,resource_id) select p_actor,'employee.bulk-deactivate','employee',value from jsonb_array_elements_text(p_data->'ids');
 else insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values(p_actor,'employee.'||p_action,'employee',p_id::text);end if;
 return result;end $$;
alter function public.wp_core_department_write(uuid,text,uuid,jsonb) rename to wp_core_department_write_before_system;
create function public.wp_core_department_write(p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 result:=public.wp_core_department_write_before_system(p_actor,p_action,p_id,p_data);
 insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values(p_actor,'department.'||p_action,'department',coalesce(p_id::text,result->>'id'));
 return result;end $$;
alter function public.wp_core_devices(uuid,uuid,text,uuid,jsonb) rename to wp_core_devices_before_system;
create function public.wp_core_devices(p_actor uuid,p_device uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;settings jsonb;begin
 result:=public.wp_core_devices_before_system(p_actor,p_device,p_action,p_id,p_data);
 if p_action in ('status','delete') then insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values(p_actor,'device.'||p_action,'device',p_id::text);end if;
 if p_action='agent-config' then
   select jsonb_object_agg(section,value||jsonb_build_object('revision',revision)) into settings from public.wp_system_settings;
   result:=result||jsonb_build_object('settings',settings,'idleThreshold',(settings->'monitoring'->>'idleMinutes')::integer*60,
    'trackingInterval',(settings->'monitoring'->>'evaluationSeconds')::integer,'syncInterval',(settings->'monitoring'->>'syncMinutes')::integer*60,'workingHoursPolicy',settings->'workingHours');
 end if;
 return result;end $$;

alter function public.wp_auth_create_user(jsonb) rename to wp_auth_create_user_before_system;
create function public.wp_auth_create_user(p_user jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 result:=public.wp_auth_create_user_before_system(p_user);
 insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values((p_user->>'created_by')::uuid,'employee.create','employee',p_user->>'id');
 return result;end $$;
alter function public.wp_auth_create_device(jsonb) rename to wp_auth_create_device_before_system;
create function public.wp_auth_create_device(p_device jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 result:=public.wp_auth_create_device_before_system(p_device);
 insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values((p_device->>'created_by')::uuid,'device.provision','device',p_device->>'id');
 return result;end $$;
alter function public.wp_category_rules(uuid,uuid,uuid,text,uuid,jsonb) rename to wp_category_rules_before_system;
create function public.wp_category_rules(p_actor uuid,p_device uuid,p_session uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 result:=public.wp_category_rules_before_system(p_actor,p_device,p_session,p_action,p_id,p_data);
 if p_action in ('create','update','delete') then
  insert into public.wp_audit_logs(actor_id,action,resource,resource_id) values(p_actor,'category.'||p_action,'app-category',coalesce(p_id::text,result->>'id'));
 end if;
 return result;end $$;
alter function public.wp_core_consent(uuid,uuid,text,jsonb) rename to wp_core_consent_before_system;
create function public.wp_core_consent(p_actor uuid,p_device uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 result:=public.wp_core_consent_before_system(p_actor,p_device,p_action,p_data);
 if p_action='update' then insert into public.wp_audit_logs(actor_id,action,resource) values(p_actor,'consent-policy.update','consent-policy');end if;
 return result;end $$;

-- No browser/custom-JWT direct access. Express uses service_role, with scoped RPCs.
do $$declare t text;f record;begin
 foreach t in array array['wp_system_settings','wp_notifications','wp_audit_logs','wp_realtime_events','wp_device_connectivity'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy wp_system_deny on public.%I for all to anon,authenticated using(false) with check(false)',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
  ('wp_system','wp_system_change','wp_system_event_order','wp_system_events','wp_system_event_visible','wp_core_employee_write','wp_core_department_write','wp_core_devices','wp_auth_create_user','wp_auth_create_device','wp_category_rules','wp_core_consent') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant select,update on public.wp_system_settings to service_role;
grant select,insert,update on public.wp_notifications,public.wp_device_connectivity to service_role;
grant select,insert on public.wp_audit_logs,public.wp_realtime_events to service_role;
grant usage,select on sequence public.wp_realtime_events_seq_seq to service_role;
commit;
