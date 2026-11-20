-- PROPOSAL ONLY. Not applied automatically. Review against the complete database
-- schema before applying; the inspected REST schema exposed no tables or RPCs.
-- This is custom authentication, entirely separate from Supabase Auth.
begin;

create table public.wp_auth_users (
  id uuid primary key,
  email text not null unique check (email = lower(trim(email))),
  password_hash text not null check (password_hash ~ '^\$2[aby]\$'),
  role text not null check (role in ('A', 'M', 'E')),
  is_active boolean not null default true,
  auth_version integer not null default 0,
  must_change_password boolean not null default false,
  temporary_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (not must_change_password or temporary_expires_at is not null)
);
create table public.wp_auth_devices (
  id uuid primary key,
  user_id uuid not null references public.wp_auth_users(id),
  credential_hash text not null unique check (length(credential_hash) = 64),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.wp_auth_devices(user_id);
create table public.wp_auth_sessions (
  id uuid primary key,
  user_id uuid not null references public.wp_auth_users(id),
  device_id uuid references public.wp_auth_devices(id),
  auth_version integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.wp_auth_sessions(user_id);
create index on public.wp_auth_sessions(device_id);
create table public.wp_auth_refresh_tokens (
  token_hash text primary key check (length(token_hash) = 64),
  session_id uuid not null references public.wp_auth_sessions(id),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index on public.wp_auth_refresh_tokens(session_id);
create table public.wp_auth_password_resets (
  token_hash text primary key check (length(token_hash) = 64),
  user_id uuid not null references public.wp_auth_users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.wp_auth_password_resets(user_id);
-- Explicit manager scope until a reviewed department/employee schema is available.
create table public.wp_auth_manager_assignments (
  manager_id uuid not null references public.wp_auth_users(id),
  employee_id uuid not null references public.wp_auth_users(id),
  primary key (manager_id, employee_id),
  check (manager_id <> employee_id)
);

-- One-time trusted operator bootstrap. No HTTP endpoint calls this function.
create function public.wp_auth_bootstrap_admin(p_id uuid, p_email text, p_password_hash text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  lock table public.wp_auth_users in share row exclusive mode;
  if exists(select 1 from public.wp_auth_users) then raise insufficient_privilege; end if;
  insert into public.wp_auth_users(id,email,password_hash,role) values(p_id,p_email,p_password_hash,'A');
end $$;

create function public.wp_auth_create_user(p_user jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare u public.wp_auth_users;
begin
  perform 1 from public.wp_auth_users where id = (p_user->>'created_by')::uuid
    and role = 'A' and is_active and not must_change_password for update;
  if not found then raise insufficient_privilege; end if;
  insert into public.wp_auth_users(id, email, password_hash, role, must_change_password, temporary_expires_at)
    values ((p_user->>'id')::uuid, p_user->>'email', p_user->>'password_hash', p_user->>'role',
      (p_user->>'must_change_password')::boolean, (p_user->>'temporary_expires_at')::timestamptz) returning * into u;
  return to_jsonb(u);
end $$;

create function public.wp_auth_create_device(p_device jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare d public.wp_auth_devices;
begin
  perform 1 from public.wp_auth_users where id = (p_device->>'created_by')::uuid
    and role = 'A' and is_active and not must_change_password for update;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.wp_auth_users where id = (p_device->>'user_id')::uuid and is_active;
  if not found then raise insufficient_privilege; end if;
  insert into public.wp_auth_devices(id, user_id, credential_hash)
    values ((p_device->>'id')::uuid, (p_device->>'user_id')::uuid, p_device->>'credential_hash') returning * into d;
  return to_jsonb(d);
end $$;

create function public.wp_auth_create_session(p_session jsonb, p_refresh jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.wp_auth_users where id = (p_session->>'user_id')::uuid
    and is_active and auth_version = (p_session->>'auth_version')::integer
    and (not must_change_password or temporary_expires_at > now()) for update;
  if not found then raise insufficient_privilege; end if;
  if p_session->>'device_id' is not null then
    perform 1 from public.wp_auth_devices where id = (p_session->>'device_id')::uuid
      and user_id = (p_session->>'user_id')::uuid and is_active;
    if not found then raise insufficient_privilege; end if;
  end if;
  insert into public.wp_auth_sessions(id, user_id, device_id, auth_version, expires_at)
    values ((p_session->>'id')::uuid, (p_session->>'user_id')::uuid, (p_session->>'device_id')::uuid,
      (p_session->>'auth_version')::integer, (p_session->>'expires_at')::timestamptz);
  insert into public.wp_auth_refresh_tokens(token_hash, session_id, expires_at)
    values (p_refresh->>'token_hash', (p_session->>'id')::uuid, (p_session->>'expires_at')::timestamptz);
end $$;

create function public.wp_auth_rotate_refresh(p_hash text, p_replacement jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare t public.wp_auth_refresh_tokens; s public.wp_auth_sessions; u public.wp_auth_users; owner_id uuid;
begin
  select sessions.user_id into owner_id from public.wp_auth_refresh_tokens tokens
    join public.wp_auth_sessions sessions on sessions.id = tokens.session_id where tokens.token_hash = p_hash;
  if not found then return jsonb_build_object('status','invalid'); end if;
  -- Consistent user -> session -> token locking across all credential mutations.
  select * into u from public.wp_auth_users where id = owner_id for update;
  select sessions.* into s from public.wp_auth_sessions sessions join public.wp_auth_refresh_tokens tokens
    on sessions.id = tokens.session_id where tokens.token_hash = p_hash for update of sessions;
  select * into t from public.wp_auth_refresh_tokens where token_hash = p_hash for update;
  if s.revoked_at is not null then return jsonb_build_object('status','invalid'); end if;
  if t.used_at is not null then
    update public.wp_auth_sessions set revoked_at = now() where id = s.id;
    return jsonb_build_object('status','replayed');
  end if;
  if not u.is_active or u.auth_version <> s.auth_version or s.expires_at <= now() or t.expires_at <= now()
    or (u.must_change_password and u.temporary_expires_at <= now()) then return jsonb_build_object('status','invalid'); end if;
  if s.device_id is not null then
    perform 1 from public.wp_auth_devices where id = s.device_id and user_id = u.id and is_active;
    if not found then return jsonb_build_object('status','invalid'); end if;
  end if;
  update public.wp_auth_refresh_tokens set used_at = now() where token_hash = p_hash;
  insert into public.wp_auth_refresh_tokens(token_hash, session_id, expires_at)
    values (p_replacement->>'token_hash', s.id, s.expires_at);
  return jsonb_build_object('status','ok','session',to_jsonb(s));
end $$;

create function public.wp_auth_store_reset(p_reset jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.wp_auth_users where id = (p_reset->>'user_id')::uuid and is_active for update;
  if not found then return; end if;
  update public.wp_auth_password_resets set used_at = now() where user_id = (p_reset->>'user_id')::uuid and used_at is null;
  insert into public.wp_auth_password_resets(token_hash, user_id, expires_at)
    values (p_reset->>'token_hash', (p_reset->>'user_id')::uuid, (p_reset->>'expires_at')::timestamptz);
end $$;

create function public.wp_auth_reset_password(p_hash text, p_password_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.wp_auth_password_resets; owner_id uuid; owner_email text;
begin
  select user_id into owner_id from public.wp_auth_password_resets where token_hash = p_hash;
  if not found then return null; end if;
  select email into owner_email from public.wp_auth_users where id = owner_id and is_active for update;
  if not found then return null; end if;
  select * into r from public.wp_auth_password_resets where token_hash = p_hash for update;
  if r.used_at is not null or r.expires_at <= now() then return null; end if;
  update public.wp_auth_users set password_hash = p_password_hash, auth_version = auth_version + 1,
    must_change_password = false, temporary_expires_at = null where id = owner_id;
  update public.wp_auth_password_resets set used_at = now() where user_id = owner_id and used_at is null;
  update public.wp_auth_sessions set revoked_at = now() where user_id = owner_id and revoked_at is null;
  return jsonb_build_object('user_id',owner_id,'email',owner_email);
end $$;

create function public.wp_auth_change_password(p_user_id uuid, p_expected_hash text, p_password_hash text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.wp_auth_users where id = p_user_id and is_active and password_hash = p_expected_hash for update;
  if not found then return false; end if;
  update public.wp_auth_users set password_hash = p_password_hash, auth_version = auth_version + 1,
    must_change_password = false, temporary_expires_at = null where id = p_user_id;
  update public.wp_auth_sessions set revoked_at = now() where user_id = p_user_id and revoked_at is null;
  update public.wp_auth_password_resets set used_at = now() where user_id = p_user_id and used_at is null;
  return true;
end $$;

alter table public.wp_auth_users enable row level security;
alter table public.wp_auth_devices enable row level security;
alter table public.wp_auth_sessions enable row level security;
alter table public.wp_auth_refresh_tokens enable row level security;
alter table public.wp_auth_password_resets enable row level security;
alter table public.wp_auth_manager_assignments enable row level security;
-- Explicit browser deny policies. Custom JWTs are checked by Express, not by
-- Supabase Auth; only the trusted backend service_role can bypass these policies.
create policy wp_auth_users_deny_browser on public.wp_auth_users for all to anon, authenticated using (false) with check (false);
create policy wp_auth_devices_deny_browser on public.wp_auth_devices for all to anon, authenticated using (false) with check (false);
create policy wp_auth_sessions_deny_browser on public.wp_auth_sessions for all to anon, authenticated using (false) with check (false);
create policy wp_auth_refresh_deny_browser on public.wp_auth_refresh_tokens for all to anon, authenticated using (false) with check (false);
create policy wp_auth_resets_deny_browser on public.wp_auth_password_resets for all to anon, authenticated using (false) with check (false);
create policy wp_auth_managers_deny_browser on public.wp_auth_manager_assignments for all to anon, authenticated using (false) with check (false);
revoke all on public.wp_auth_users, public.wp_auth_devices, public.wp_auth_sessions,
  public.wp_auth_refresh_tokens, public.wp_auth_password_resets, public.wp_auth_manager_assignments from public, anon, authenticated;
grant select, insert, update, delete on public.wp_auth_users, public.wp_auth_devices, public.wp_auth_sessions,
  public.wp_auth_refresh_tokens, public.wp_auth_password_resets, public.wp_auth_manager_assignments to service_role;
revoke all on function public.wp_auth_bootstrap_admin(uuid,text,text), public.wp_auth_create_user(jsonb), public.wp_auth_create_device(jsonb),
  public.wp_auth_create_session(jsonb,jsonb), public.wp_auth_rotate_refresh(text,jsonb),
  public.wp_auth_store_reset(jsonb), public.wp_auth_reset_password(text,text),
  public.wp_auth_change_password(uuid,text,text) from public, anon, authenticated;
grant execute on function public.wp_auth_bootstrap_admin(uuid,text,text), public.wp_auth_create_user(jsonb), public.wp_auth_create_device(jsonb),
  public.wp_auth_create_session(jsonb,jsonb), public.wp_auth_rotate_refresh(text,jsonb),
  public.wp_auth_store_reset(jsonb), public.wp_auth_reset_password(text,text),
  public.wp_auth_change_password(uuid,text,text) to service_role;
commit;
