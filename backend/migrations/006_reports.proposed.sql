-- REVIEW ONLY; requires approved 001-005. Never run automatically.
begin;
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
commit;
