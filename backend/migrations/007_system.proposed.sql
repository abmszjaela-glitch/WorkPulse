-- REVIEW ONLY. Requires 001-006; do not apply to production without approval.
-- Custom JWTs are checked by Express; only the server service role may call RPCs.
begin;
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
