-- REVIEW ONLY: requires approved 001_auth.proposed.sql. Never auto-applied.
-- No live management schema was exposed; all new structures are explicit proposals.
-- CREATE/ADD COLUMN intentionally fail on collisions; nothing is silently replaced.
begin;
alter table public.wp_auth_users add column deleted_at timestamptz;
alter table public.wp_auth_devices add column name text not null default '' check(length(name)<=100),
  add column platform text not null default '' check(length(platform)<=100),
  add column registered_at timestamptz, add column last_seen timestamptz, add column deleted_at timestamptz;
create table public.wp_departments (
  id uuid primary key, name text not null check(length(trim(name)) between 1 and 100),
  description text not null default '' check(length(description)<=2000),
  manager_id uuid references public.wp_auth_users(id),
  is_active boolean not null default true, deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index wp_departments_name_unique on public.wp_departments(lower(trim(name))) where deleted_at is null;
create index on public.wp_departments(manager_id);
create table public.wp_employee_profiles (
  user_id uuid primary key references public.wp_auth_users(id),
  employee_code text not null unique check(length(employee_code) between 1 and 64),
  first_name text not null default '' check(length(first_name)<=100),
  last_name text not null default '' check(length(last_name)<=100),
  phone text not null default '' check(length(phone)<=32),
  department_id uuid references public.wp_departments(id),
  language text not null default 'en' check(length(language)<=35),
  timezone text not null default 'UTC' check(length(timezone)<=100),
  avatar_base64 text check(length(avatar_base64)<=350000),
  email_daily_summary boolean not null default false,
  idle_alerts boolean not null default false,
  email_weekly_report boolean not null default false
);
create index on public.wp_employee_profiles(department_id);
create table public.wp_privacy_policies (
  version integer primary key check(version>0), content text not null check(length(trim(content)) between 1 and 50000),
  is_current boolean not null default true, created_by uuid not null references public.wp_auth_users(id),
  created_at timestamptz not null default now()
);
create unique index wp_privacy_one_current on public.wp_privacy_policies(is_current) where is_current;
create table public.wp_consent_receipts (
  user_id uuid not null references public.wp_auth_users(id), policy_version integer not null references public.wp_privacy_policies(version),
  device_id uuid references public.wp_auth_devices(id), accepted_at timestamptz not null default now(),
  primary key(user_id,policy_version)
);
create index on public.wp_consent_receipts(policy_version);
create function public.wp_core_profile_init() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into public.wp_employee_profiles(user_id,employee_code) values(new.id,'WP-'||new.id::text);
  return new;
end $$;
create trigger wp_core_profile_init after insert on public.wp_auth_users for each row execute function public.wp_core_profile_init();
-- Reviewed backfill only when applying: no identity/password values are overwritten.
insert into public.wp_employee_profiles(user_id,employee_code) select id,'WP-'||id::text from public.wp_auth_users;

create view public.wp_core_employees with (security_invoker=true) as
select u.id,u.email,u.role,u.is_active,u.deleted_at,u.created_at,p.employee_code,p.first_name,p.last_name,p.phone,p.department_id,
  d.name as department_name,
  exists(select 1 from public.wp_auth_devices x where x.user_id=u.id and x.registered_at is not null and x.deleted_at is null) as agent_installed,
  (select max(x.last_seen) from public.wp_auth_devices x where x.user_id=u.id and x.deleted_at is null) as last_seen
from public.wp_auth_users u join public.wp_employee_profiles p on p.user_id=u.id
left join public.wp_departments d on d.id=p.department_id;

create function public.wp_core_role(p_actor uuid,p_roles text[]) returns text
language plpgsql security invoker set search_path='' as $$
declare r text;
begin
  select role into r from public.wp_auth_users where id=p_actor and is_active and deleted_at is null and not must_change_password;
  if not found or not(r=any(p_roles)) then raise sqlstate 'PT403' using message='Forbidden'; end if;
  return r;
end $$;
create function public.wp_core_can_read(p_actor uuid,p_employee uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.wp_auth_users a where a.id=p_actor and a.is_active and a.deleted_at is null and
    (a.role='A' or a.id=p_employee or (a.role='M' and
      (exists(select 1 from public.wp_auth_manager_assignments m where m.manager_id=p_actor and m.employee_id=p_employee)
       or exists(select 1 from public.wp_employee_profiles p join public.wp_departments d on d.id=p.department_id
          where p.user_id=p_employee and d.manager_id=p_actor and d.deleted_at is null)))))
$$;
create function public.wp_core_department_visible(p_actor uuid,p_department uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.wp_auth_users a where a.id=p_actor and a.is_active and a.deleted_at is null and
    (a.role='A' or (a.role='M' and (exists(select 1 from public.wp_departments d where d.id=p_department and d.manager_id=p_actor)
      or exists(select 1 from public.wp_employee_profiles p join public.wp_auth_manager_assignments m on m.employee_id=p.user_id
         where p.department_id=p_department and m.manager_id=p_actor)))))
$$;

create function public.wp_core_employees_read(p_actor uuid,p_options jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; total bigint; page_no integer:=coalesce((p_options->>'page')::integer,1);
  page_size integer:=coalesce((p_options->>'pageSize')::integer,20);
begin
  perform public.wp_core_role(p_actor,array['A','M']);
  if page_no<1 or page_size<1 or page_size>100 then raise sqlstate 'PT400' using message='Invalid pagination'; end if;
  if p_options->>'export'='true' then page_no:=1; page_size:=10000; end if;
  if p_options->>'id' is not null and not exists(select 1 from public.wp_core_employees e where e.id=(p_options->>'id')::uuid
    and e.deleted_at is null and public.wp_core_can_read(p_actor,e.id)) then raise sqlstate 'PT404' using message='Employee not found'; end if;
  with filtered as (
    select e.* from public.wp_core_employees e where e.deleted_at is null and public.wp_core_can_read(p_actor,e.id)
      and (p_options->>'id' is null or e.id=(p_options->>'id')::uuid)
      and (p_options->>'departmentId' is null or e.department_id=(p_options->>'departmentId')::uuid)
      and (p_options->>'role' is null or e.role=p_options->>'role')
      and (p_options->>'status' is null or e.is_active=((p_options->>'status')='active'))
      and (p_options->>'search' is null or position(lower(p_options->>'search') in lower(e.email||' '||e.first_name||' '||e.last_name||' '||e.employee_code))>0)
  ), paged as (select * from filtered order by created_at,id limit page_size offset (page_no-1)*page_size)
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb) into total,result;
  if p_options->>'export'='true' and total>10000 then raise sqlstate 'PT413' using message='Filter export to 10000 records or fewer'; end if;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'pageSize',page_size);
end $$;

create function public.wp_core_employee_write(p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target public.wp_auth_users; dept uuid; ids uuid[]; n integer; result jsonb;
begin
  perform public.wp_core_role(p_actor,array['A']);
  -- Serialize core mutations to protect last-admin and reassignment invariants.
  perform pg_advisory_xact_lock(730031);
  if p_action='create' then
    if p_data->>'departmentId' is not null then
      perform 1 from public.wp_departments where id=(p_data->>'departmentId')::uuid and is_active and deleted_at is null for update;
      if not found then raise sqlstate 'PT400' using message='Department unavailable'; end if;
    end if;
    insert into public.wp_auth_users(id,email,password_hash,role,must_change_password,temporary_expires_at)
      values(p_id,p_data->>'email',p_data->>'passwordHash',p_data->>'role',
        (p_data->>'temporary')::boolean,(p_data->>'temporaryExpiresAt')::timestamptz);
  elsif p_action='bulk-deactivate' then
    select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_data->'ids');
    if p_actor=any(ids) then raise sqlstate 'PT409' using message='Cannot deactivate your own account'; end if;
    select count(*) into n from public.wp_auth_users where id=any(ids) and deleted_at is null;
    if n<>cardinality(ids) then raise sqlstate 'PT404' using message='Employee not found'; end if;
    if not exists(select 1 from public.wp_auth_users where role='A' and is_active and deleted_at is null and not(id=any(ids)))
      then raise sqlstate 'PT409' using message='An active Admin must remain'; end if;
    update public.wp_auth_users set is_active=false,auth_version=auth_version+1 where id=any(ids);
    update public.wp_auth_sessions set revoked_at=now() where user_id=any(ids) and revoked_at is null;
    return jsonb_build_object('updated',n);
  else
    select * into target from public.wp_auth_users where id=p_id and deleted_at is null for update;
    if not found then raise sqlstate 'PT404' using message='Employee not found'; end if;
    if p_actor=p_id and (p_action in ('delete','reset-password') or (p_action='status' and not(p_data->>'active')::boolean)
      or (p_action='update' and p_data->>'role' is not null and p_data->>'role'<>'A'))
      then raise sqlstate 'PT409' using message='Use profile controls for your own account'; end if;
    if target.role='A' and (p_action='delete' or (p_action='status' and not(p_data->>'active')::boolean)
      or (p_action='update' and p_data->>'role' is not null and p_data->>'role'<>'A'))
      and not exists(select 1 from public.wp_auth_users where id<>p_id and role='A' and is_active and deleted_at is null)
      then raise sqlstate 'PT409' using message='An active Admin must remain'; end if;
    if p_action='status' then
      update public.wp_auth_users set is_active=(p_data->>'active')::boolean,auth_version=auth_version+1 where id=p_id;
    elsif p_action='delete' then
      if exists(select 1 from public.wp_departments where manager_id=p_id and deleted_at is null)
        then raise sqlstate 'PT409' using message='Reassign managed departments first'; end if;
      update public.wp_auth_users set deleted_at=now(),is_active=false,auth_version=auth_version+1 where id=p_id;
      update public.wp_auth_devices set is_active=false where user_id=p_id;
    elsif p_action='reset-password' then
      update public.wp_auth_users set password_hash=p_data->>'passwordHash',must_change_password=true,
        temporary_expires_at=(p_data->>'temporaryExpiresAt')::timestamptz,auth_version=auth_version+1 where id=p_id;
      update public.wp_auth_password_resets set used_at=now() where user_id=p_id and used_at is null;
    elsif p_action='update' then
      if p_data->>'role' is not null and p_data->>'role' not in ('A','M') and exists(select 1 from public.wp_departments where manager_id=p_id and deleted_at is null)
        then raise sqlstate 'PT409' using message='Reassign managed departments first'; end if;
      update public.wp_auth_users set email=coalesce(p_data->>'email',email),role=coalesce(p_data->>'role',role),
        auth_version=auth_version+case when p_data ? 'role' or p_data ? 'email' then 1 else 0 end where id=p_id;
    elsif p_action<>'department' then raise sqlstate 'PT400' using message='Invalid operation'; end if;
    if p_action in ('status','delete','reset-password') or (p_action='update' and (p_data ? 'role' or p_data ? 'email')) then
      update public.wp_auth_sessions set revoked_at=now() where user_id=p_id and revoked_at is null;
    end if;
  end if;
  if p_action in ('create','update','department') then
    if p_data ? 'departmentId' then
      dept:=(p_data->>'departmentId')::uuid;
      if dept is not null then
        perform 1 from public.wp_departments where id=dept and is_active and deleted_at is null for update;
        if not found then raise sqlstate 'PT400' using message='Department unavailable'; end if;
      end if;
      update public.wp_employee_profiles set department_id=dept where user_id=p_id;
    end if;
    update public.wp_employee_profiles set first_name=coalesce(p_data->>'firstName',first_name),last_name=coalesce(p_data->>'lastName',last_name),
      phone=coalesce(p_data->>'phone',phone),employee_code=coalesce(p_data->>'employeeCode',employee_code) where user_id=p_id;
  end if;
  select to_jsonb(e) into result from public.wp_core_employees e where e.id=p_id;
  return result;
end $$;

create function public.wp_core_departments_read(p_actor uuid,p_options jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; total bigint; page_no integer:=coalesce((p_options->>'page')::integer,1);
  page_size integer:=coalesce((p_options->>'pageSize')::integer,20);
begin
  perform public.wp_core_role(p_actor,array['A','M']);
  if page_no<1 or page_size<1 or page_size>100 then raise sqlstate 'PT400' using message='Invalid pagination'; end if;
  if p_options->>'export'='true' then page_no:=1; page_size:=10000; end if;
  if p_options->>'id' is not null and not exists(select 1 from public.wp_departments d where d.id=(p_options->>'id')::uuid
    and d.deleted_at is null and public.wp_core_department_visible(p_actor,d.id)) then raise sqlstate 'PT404' using message='Department not found'; end if;
  with filtered as (
    select d.*, (select count(*) from public.wp_core_employees e where e.department_id=d.id and e.deleted_at is null
        and public.wp_core_can_read(p_actor,e.id)) as employee_count,
      (select count(*) from public.wp_core_employees e where e.department_id=d.id and e.deleted_at is null and e.is_active
        and public.wp_core_can_read(p_actor,e.id)) as active_accounts
    from public.wp_departments d where d.deleted_at is null and public.wp_core_department_visible(p_actor,d.id)
      and (p_options->>'id' is null or d.id=(p_options->>'id')::uuid)
      and (p_options->>'status' is null or d.is_active=((p_options->>'status')='active'))
      and (p_options->>'search' is null or position(lower(p_options->>'search') in lower(d.name||' '||d.description))>0)
  ), paged as (select * from filtered order by created_at,id limit page_size offset (page_no-1)*page_size)
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb) into total,result;
  if p_options->>'export'='true' and total>10000 then raise sqlstate 'PT413' using message='Filter export to 10000 records or fewer'; end if;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'pageSize',page_size);
end $$;

create function public.wp_core_department_write(p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target public.wp_departments; replacement uuid; result jsonb;
begin
  perform public.wp_core_role(p_actor,array['A']);
  perform pg_advisory_xact_lock(730031);
  if p_action='delete' then
    select * into target from public.wp_departments where id=p_id and deleted_at is null for update;
    if not found then raise sqlstate 'PT404' using message='Department not found'; end if;
    replacement:=(p_data->>'reassignToDepartmentId')::uuid;
    if replacement=p_id then raise sqlstate 'PT400' using message='Choose a different department'; end if;
    if replacement is not null then
      perform 1 from public.wp_departments where id=replacement and is_active and deleted_at is null for update;
      if not found then raise sqlstate 'PT400' using message='Replacement department unavailable'; end if;
    end if;
    if replacement is null and exists(select 1 from public.wp_employee_profiles p join public.wp_auth_users u on u.id=p.user_id
      where p.department_id=p_id and u.deleted_at is null)
      then raise sqlstate 'PT409' using message='Reassign employees before deleting department'; end if;
    -- One transaction prevents partial reassignment and preserves historical records.
    update public.wp_employee_profiles p set department_id=replacement where p.department_id=p_id
      and exists(select 1 from public.wp_auth_users u where u.id=p.user_id and u.deleted_at is null);
    update public.wp_departments set is_active=false,deleted_at=now() where id=p_id returning to_jsonb(wp_departments) into result;
    return result;
  end if;
  if p_data->>'managerId' is not null then
    perform 1 from public.wp_auth_users where id=(p_data->>'managerId')::uuid and role in ('A','M') and is_active and deleted_at is null;
    if not found then raise sqlstate 'PT400' using message='Manager unavailable'; end if;
  end if;
  if p_action='create' then
    insert into public.wp_departments(id,name,description,manager_id,is_active) values(p_id,p_data->>'name',
      coalesce(p_data->>'description',''),(p_data->>'managerId')::uuid,coalesce((p_data->>'active')::boolean,true));
  elsif p_action='update' then
    update public.wp_departments set name=coalesce(p_data->>'name',name),description=coalesce(p_data->>'description',description),
      manager_id=case when p_data ? 'managerId' then (p_data->>'managerId')::uuid else manager_id end,
      is_active=coalesce((p_data->>'active')::boolean,is_active) where id=p_id and deleted_at is null;
    if not found then raise sqlstate 'PT404' using message='Department not found'; end if;
  else raise sqlstate 'PT400' using message='Invalid operation'; end if;
  select to_jsonb(d) into result from public.wp_departments d where id=p_id;
  return result;
end $$;

create function public.wp_core_devices(p_actor uuid,p_device uuid,p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; u public.wp_auth_users; d public.wp_auth_devices; s public.wp_auth_sessions;
  total bigint; page_no integer:=coalesce((p_data->>'page')::integer,1); page_size integer:=coalesce((p_data->>'pageSize')::integer,20);
begin
  if p_action in ('register','heartbeat','agent-config') then
    if p_device is null then raise sqlstate 'PT403' using message='Device authentication required'; end if;
    select * into u from public.wp_auth_users where id=p_actor and is_active and deleted_at is null and not must_change_password for update;
    if not found then raise sqlstate 'PT403' using message='Forbidden'; end if;
    select * into d from public.wp_auth_devices where id=p_device and user_id=p_actor and is_active and deleted_at is null for update;
    if not found then raise sqlstate 'PT403' using message='Device unavailable'; end if;
    if p_action='register' then
      if d.credential_hash is distinct from p_data->>'currentCredentialHash' then
        raise sqlstate 'PT401' using message='Invalid device credential'; end if;
      update public.wp_auth_devices set name=p_data->>'name',platform=p_data->>'platform',registered_at=coalesce(registered_at,now()),
        last_seen=now(),credential_hash=p_data->>'credentialHash' where id=p_device returning * into d;
      update public.wp_auth_sessions set revoked_at=now() where device_id=p_device and revoked_at is null;
      insert into public.wp_auth_sessions(id,user_id,device_id,auth_version,expires_at) values((p_data->>'sessionId')::uuid,p_actor,p_device,
        u.auth_version,(p_data->>'expiresAt')::timestamptz) returning * into s;
      insert into public.wp_auth_refresh_tokens(token_hash,session_id,expires_at) values(p_data->>'refreshHash',s.id,s.expires_at);
      return jsonb_build_object('device',to_jsonb(d)-'credential_hash','session',to_jsonb(s),'user',
        jsonb_build_object('id',u.id,'role',u.role,'auth_version',u.auth_version));
    elsif p_action='heartbeat' then
      if d.registered_at is null then raise sqlstate 'PT409' using message='Register device first'; end if;
      update public.wp_auth_devices set last_seen=now() where id=p_device returning last_seen into d.last_seen;
      return jsonb_build_object('deviceId',p_device,'lastSeen',d.last_seen);
    else
      return jsonb_build_object('deviceId',p_device,'consentAccepted',exists(select 1 from public.wp_consent_receipts c
        join public.wp_privacy_policies p on p.version=c.policy_version where c.user_id=p_actor and p.is_current),
        'policyVersion',(select version from public.wp_privacy_policies where is_current));
    end if;
  end if;
  perform public.wp_core_role(p_actor,case when p_action in ('list','get') then array['A','M'] else array['A'] end);
  if p_action in ('list','get') then
    if page_no<1 or page_size<1 or page_size>100 then raise sqlstate 'PT400' using message='Invalid pagination'; end if;
    if p_action='get' and not exists(select 1 from public.wp_auth_devices x where x.id=p_id and x.deleted_at is null
      and public.wp_core_can_read(p_actor,x.user_id)) then raise sqlstate 'PT404' using message='Device not found'; end if;
    with filtered as (select x.* from public.wp_auth_devices x where x.deleted_at is null and public.wp_core_can_read(p_actor,x.user_id)
      and (p_id is null or x.id=p_id) and (p_data->>'employeeId' is null or x.user_id=(p_data->>'employeeId')::uuid)
      and (p_data->>'status' is null or x.is_active=((p_data->>'status')='active'))),
      paged as (select * from filtered order by created_at,id limit page_size offset (page_no-1)*page_size)
    select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(paged)-'credential_hash') from paged),'[]'::jsonb) into total,result;
    return jsonb_build_object('items',result,'total',total,'page',page_no,'pageSize',page_size);
  end if;
  perform pg_advisory_xact_lock(730031);
  select * into d from public.wp_auth_devices where id=p_id and deleted_at is null for update;
  if not found then raise sqlstate 'PT404' using message='Device not found'; end if;
  if p_action='delete' then update public.wp_auth_devices set is_active=false,deleted_at=now() where id=p_id;
  elsif p_action='status' then
    if (p_data->>'active')::boolean and not exists(select 1 from public.wp_auth_users where id=d.user_id and is_active and deleted_at is null)
      then raise sqlstate 'PT409' using message='Employee unavailable'; end if;
    update public.wp_auth_devices set is_active=(p_data->>'active')::boolean where id=p_id;
  else raise sqlstate 'PT400' using message='Invalid operation'; end if;
  update public.wp_auth_sessions set revoked_at=now() where device_id=p_id and revoked_at is null;
  select to_jsonb(x)-'credential_hash' into result from public.wp_auth_devices x where id=p_id;
  return result;
end $$;

create function public.wp_core_profile(p_actor uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; total bigint; page_no integer:=coalesce((p_data->>'page')::integer,1); page_size integer:=coalesce((p_data->>'pageSize')::integer,20);
begin
  perform public.wp_core_role(p_actor,array['A','M','E']);
  if p_action='update' then
    update public.wp_employee_profiles set first_name=coalesce(p_data->>'firstName',first_name),last_name=coalesce(p_data->>'lastName',last_name),
      phone=coalesce(p_data->>'phone',phone),language=coalesce(p_data->>'language',language),timezone=coalesce(p_data->>'timezone',timezone) where user_id=p_actor;
  elsif p_action='avatar' then update public.wp_employee_profiles set avatar_base64=p_data->>'avatarBase64' where user_id=p_actor;
  elsif p_action='preferences-update' then
    update public.wp_employee_profiles set email_daily_summary=coalesce((p_data->>'emailDailySummary')::boolean,email_daily_summary),
      idle_alerts=coalesce((p_data->>'idleAlerts')::boolean,idle_alerts),email_weekly_report=coalesce((p_data->>'emailWeeklyReport')::boolean,email_weekly_report) where user_id=p_actor;
  elsif p_action='logout-all' then
    -- Same user lock as refresh/password operations; also invalidates device sessions.
    perform 1 from public.wp_auth_users where id=p_actor for update;
    update public.wp_auth_sessions set revoked_at=now() where user_id=p_actor and revoked_at is null;
    return jsonb_build_object('signedOut',true);
  elsif p_action='login-history' then
    if page_no<1 or page_size<1 or page_size>100 then raise sqlstate 'PT400' using message='Invalid pagination'; end if;
    select count(*) into total from public.wp_auth_sessions where user_id=p_actor;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from
      (select id,device_id,created_at,expires_at,revoked_at from public.wp_auth_sessions where user_id=p_actor order by created_at desc,id limit page_size offset (page_no-1)*page_size) x;
    return jsonb_build_object('items',result,'total',total,'page',page_no,'pageSize',page_size);
  elsif p_action not in ('get','preferences') then raise sqlstate 'PT400' using message='Invalid operation'; end if;
  if p_action in ('preferences','preferences-update') then
    select jsonb_build_object('emailDailySummary',email_daily_summary,'idleAlerts',idle_alerts,'emailWeeklyReport',email_weekly_report) into result
      from public.wp_employee_profiles where user_id=p_actor;
  else
    select to_jsonb(e)||jsonb_build_object('language',p.language,'timezone',p.timezone,
      'avatar',case when p.avatar_base64 is null then null else 'data:image/png;base64,'||p.avatar_base64 end) into result
      from public.wp_core_employees e join public.wp_employee_profiles p on p.user_id=e.id where e.id=p_actor and e.deleted_at is null;
  end if;
  if result is null then raise sqlstate 'PT404' using message='Profile not found'; end if;
  return result;
end $$;

create function public.wp_core_consent(p_actor uuid,p_device uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare policy public.wp_privacy_policies; result jsonb; v integer;
begin
  if p_action in ('update','status') then perform public.wp_core_role(p_actor,array['A']);
  elsif p_action='accept' then
    if p_device is null then perform public.wp_core_role(p_actor,array['E']);
    else
      perform 1 from public.wp_auth_devices d join public.wp_auth_users u on u.id=d.user_id where d.id=p_device and d.user_id=p_actor
        and d.is_active and d.deleted_at is null and u.is_active and u.deleted_at is null and not u.must_change_password;
      if not found then raise sqlstate 'PT403' using message='Device unavailable'; end if;
    end if;
  elsif p_action='policy' then perform public.wp_core_role(p_actor,array['A','M','E']);
  else raise sqlstate 'PT400' using message='Invalid operation'; end if;
  if p_action='update' then
    lock table public.wp_privacy_policies in share row exclusive mode;
    select coalesce(max(version),0)+1 into v from public.wp_privacy_policies;
    update public.wp_privacy_policies set is_current=false where is_current;
    insert into public.wp_privacy_policies(version,content,created_by) values(v,p_data->>'content',p_actor);
  end if;
  select * into policy from public.wp_privacy_policies where is_current for share;
  if not found then raise sqlstate 'PT404' using message='Privacy policy not configured'; end if;
  if p_action='accept' then
    if (p_data->>'policyVersion')::integer<>policy.version then raise sqlstate 'PT409' using message='Privacy policy changed; review current version'; end if;
    insert into public.wp_consent_receipts(user_id,policy_version,device_id) values(p_actor,policy.version,p_device) on conflict(user_id,policy_version) do nothing;
    select to_jsonb(c) into result from public.wp_consent_receipts c where user_id=p_actor and policy_version=policy.version;
    return result;
  elsif p_action='status' then
    perform 1 from public.wp_auth_users where id=(p_data->>'employeeId')::uuid and deleted_at is null;
    if not found then raise sqlstate 'PT404' using message='Employee not found'; end if;
    select to_jsonb(c) into result from public.wp_consent_receipts c where user_id=(p_data->>'employeeId')::uuid and policy_version=policy.version;
    return jsonb_build_object('employeeId',p_data->>'employeeId','policyVersion',policy.version,'accepted',result is not null,'receipt',result);
  end if;
  return to_jsonb(policy);
end $$;

create function public.wp_core_employee_summary(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.wp_core_role(p_actor,array['A','M']);
  select jsonb_build_object('totalEmployees',count(*),'activeAccounts',count(*) filter(where is_active),
    'deactivated',count(*) filter(where not is_active),'agentNotInstalled',count(*) filter(where not agent_installed)) into result
    from public.wp_core_employees e where deleted_at is null and public.wp_core_can_read(p_actor,e.id);
  return result;
end $$;

alter table public.wp_departments enable row level security;
alter table public.wp_employee_profiles enable row level security;
alter table public.wp_privacy_policies enable row level security;
alter table public.wp_consent_receipts enable row level security;
create policy wp_departments_deny_browser on public.wp_departments for all to anon,authenticated using(false) with check(false);
create policy wp_profiles_deny_browser on public.wp_employee_profiles for all to anon,authenticated using(false) with check(false);
create policy wp_policies_deny_browser on public.wp_privacy_policies for all to anon,authenticated using(false) with check(false);
create policy wp_receipts_deny_browser on public.wp_consent_receipts for all to anon,authenticated using(false) with check(false);
revoke all on public.wp_departments,public.wp_employee_profiles,public.wp_privacy_policies,public.wp_consent_receipts,public.wp_core_employees from public,anon,authenticated;
grant select,insert,update,delete on public.wp_departments,public.wp_employee_profiles,public.wp_privacy_policies,public.wp_consent_receipts to service_role;
grant select on public.wp_core_employees to service_role;
revoke all on function public.wp_core_profile_init(),public.wp_core_role(uuid,text[]),public.wp_core_can_read(uuid,uuid),
  public.wp_core_department_visible(uuid,uuid),public.wp_core_employees_read(uuid,jsonb),public.wp_core_employee_write(uuid,text,uuid,jsonb),
  public.wp_core_employee_summary(uuid),public.wp_core_departments_read(uuid,jsonb),public.wp_core_department_write(uuid,text,uuid,jsonb),
  public.wp_core_devices(uuid,uuid,text,uuid,jsonb),public.wp_core_profile(uuid,text,jsonb),public.wp_core_consent(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.wp_core_profile_init(),public.wp_core_role(uuid,text[]),public.wp_core_can_read(uuid,uuid),
  public.wp_core_department_visible(uuid,uuid),public.wp_core_employees_read(uuid,jsonb),public.wp_core_employee_write(uuid,text,uuid,jsonb),
  public.wp_core_employee_summary(uuid),public.wp_core_departments_read(uuid,jsonb),public.wp_core_department_write(uuid,text,uuid,jsonb),
  public.wp_core_devices(uuid,uuid,text,uuid,jsonb),public.wp_core_profile(uuid,text,jsonb),public.wp_core_consent(uuid,uuid,text,jsonb) to service_role;
commit;
