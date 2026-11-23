-- REVIEW ONLY: requires approved 001,002,003. No live migration is run automatically.
begin;
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
commit;
