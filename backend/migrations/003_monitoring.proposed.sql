-- REVIEW ONLY. Requires approved 001 + 002. No live execution is performed.
begin;
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
commit;
