-- REVIEW ONLY: requires approved proposals 001-004; never automatically applied.
begin;
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
commit;
