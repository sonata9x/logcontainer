begin;
-- No passwords or bearer tokens are stored in these application tables.
create table if not exists public.account_security_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sessions_valid_after timestamptz,
  pending_operation uuid,
  operation_started_at timestamptz
);
create table if not exists public.account_username_history (
  username text primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  reserved_at timestamptz not null default now()
);
create table if not exists public.account_security_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check(action in ('id_changed','password_changed','password_reset','password_update_failed','reauth_failed','login_failed','request_limited','recovery_issued','recovery_revoked','recovery_used','backup_issued','operation_aborted')),
  previous_username text, next_username text,
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_user_time on public.account_security_events(user_id, created_at desc, id desc);
create table if not exists public.account_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check(kind in ('link','backup')),
  issued_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz, revoked_at timestamptz,
  check(kind = 'backup' or expires_at is not null)
);
create index if not exists account_recovery_tokens_user on public.account_recovery_tokens(user_id);
alter table public.account_security_state enable row level security;
alter table public.account_username_history enable row level security;
alter table public.account_security_events enable row level security;
alter table public.account_recovery_tokens enable row level security;
revoke all on public.account_security_state, public.account_username_history, public.account_security_events, public.account_recovery_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.account_security_state, public.account_username_history, public.account_security_events, public.account_recovery_tokens to service_role;
grant usage, select on sequence public.account_security_events_id_seq to service_role;

-- A refreshed JWT must not revive a pre-change session. Compare the original
-- auth.sessions creation time, not JWT iat. Existing accounts have no cutoff.
create or replace function public.account_session_valid()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare state public.account_security_state; session_claim text;
begin
  if auth.uid() is null then return false; end if;
  select * into state from public.account_security_state where user_id = auth.uid();
  if state.pending_operation is not null then return false; end if;
  if state.sessions_valid_after is null then return true; end if;
  session_claim := auth.jwt()->>'session_id';
  if session_claim is null or session_claim !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  return exists(select 1 from auth.sessions where id = session_claim::uuid and user_id = auth.uid() and created_at > state.sessions_valid_after);
exception when invalid_text_representation then return false;
end;
$$;
create or replace function public.is_account_approved(target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = target_user_id and account_status = 'approved')
    and (target_user_id is distinct from auth.uid() or public.account_session_valid());
$$;

-- Reserve every past login ID. Enforce in a DB trigger, including signup races
-- The existing session-context RPC used a raw account_status check. Gate it
-- too, so workspace rendering and approved APIs cannot bypass revocation.
create or replace function public.get_personal_session_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name,
      'account_status', p.account_status, 'is_site_admin', p.is_site_admin,
      'approved_at', p.approved_at, 'approved_by', p.approved_by,
      'created_at', p.created_at, 'updated_at', p.updated_at
    ),
    'workspace', jsonb_build_object(
      'id', w.id, 'name', w.name, 'owner_id', w.owner_id,
      'created_at', w.created_at, 'updated_at', w.updated_at
    )
  ) from public.profiles p join public.workspaces w on w.owner_id=p.id
  where p.id=auth.uid() and public.is_account_approved(auth.uid()) limit 1;
$$;
revoke all on function public.get_personal_session_context() from public,anon;
grant execute on function public.get_personal_session_context() to authenticated;

-- Reserve every past login ID. Enforce in a DB trigger, including signup races
-- and service-role writes. Profiles remain the sole current-login lookup.
insert into public.account_username_history(username, user_id) select username, id from public.profiles on conflict do nothing;
create or replace function public.reserve_account_username()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  if tg_op = 'UPDATE' and new.username = old.username then return new; end if;
  if tg_op = 'UPDATE' and coalesce(auth.role(),'') <> 'service_role' then raise exception 'server verified ID change required'; end if;
  if tg_op = 'UPDATE' then
    insert into public.account_username_history(username,user_id) values(old.username,old.id) on conflict do nothing;
    if exists(select 1 from public.account_username_history where username = new.username) then raise exception 'username reserved'; end if;
  end if;
  -- An AFTER trigger allows the new profile FK to exist. Unique insertion locks
  -- serialize simultaneous registrations and ID changes.
  insert into public.account_username_history(username,user_id) values(new.username,new.id) on conflict do nothing;
  select user_id into owner_id from public.account_username_history where username = new.username;
  if owner_id <> new.id then raise exception 'username reserved'; end if;
  return new;
end;
$$;
drop trigger if exists profiles_reserve_username on public.profiles;
create trigger profiles_reserve_username after insert or update of username on public.profiles for each row execute function public.reserve_account_username();

create or replace function public.change_account_username(target_user_id uuid, next_username text)
returns text language plpgsql security definer set search_path = public as $$
declare old_username text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'permission denied'; end if;
  if next_username is null or next_username !~ '^[a-z0-9가-힣._-]{2,40}$' then raise exception 'invalid username'; end if;
  select username into old_username from public.profiles where id = target_user_id and account_status = 'approved' for update;
  if old_username is null then raise exception 'account unavailable'; end if;
  insert into public.account_security_state(user_id) values(target_user_id) on conflict do nothing;
  perform 1 from public.account_security_state where user_id=target_user_id and pending_operation is null for update;
  if not found then raise exception 'security operation pending'; end if;
  if old_username = next_username then return old_username; end if;
  update public.profiles set username = next_username where id = target_user_id;
  -- Never retarget username-only invitations to a different person. Stale
  -- pending invites to the old ID are revoked; existing UUID shares untouched.
  update public.pending_resource_shares set revoked_at=now() where username=old_username and accepted_at is null and revoked_at is null;
  insert into public.account_security_events(user_id,actor_id,action,previous_username,next_username)
    values(target_user_id,target_user_id,'id_changed',old_username,next_username);
  return next_username;
end;
$$;

create or replace function public.issue_account_recovery(target_user_id uuid, actor_id uuid, next_token_hash text, token_kind text default 'link')
returns jsonb language plpgsql security definer set search_path = public as $$
declare token_id uuid; token_expiry timestamptz; state public.account_security_state;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'permission denied'; end if;
  if next_token_hash is null or next_token_hash !~ '^[a-f0-9]{64}$' or token_kind not in ('link','backup') then raise exception 'invalid token'; end if;
  if token_kind='link' then
    if not public.is_account_approved(actor_id) or not public.is_site_admin(actor_id) then raise exception 'permission denied'; end if;
    if target_user_id=actor_id then raise exception 'use own backup code'; end if;
    token_expiry := now()+interval '30 minutes';
  else
    if actor_id <> target_user_id or not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  end if;
  perform 1 from public.profiles where id=target_user_id and account_status='approved' for update;
  if not found then raise exception 'account unavailable'; end if;
  insert into public.account_security_state(user_id) values(target_user_id) on conflict do nothing;
  select * into state from public.account_security_state where user_id=target_user_id for update;
  if state.pending_operation is not null then raise exception 'security operation pending'; end if;
  update public.account_recovery_tokens set revoked_at=now() where user_id=target_user_id and kind=token_kind and used_at is null and revoked_at is null;
  insert into public.account_recovery_tokens(user_id,token_hash,kind,issued_by,expires_at)
    values(target_user_id,next_token_hash,token_kind,actor_id,token_expiry) returning id into token_id;
  insert into public.account_security_events(user_id,actor_id,action) values(target_user_id,actor_id,case token_kind when 'link' then 'recovery_issued' else 'backup_issued' end);
  return jsonb_build_object('id',token_id,'expiresAt',token_expiry);
end;
$$;

create or replace function public.revoke_account_recovery(target_token_id uuid, actor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_user_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' or not public.is_account_approved(actor_id) or not public.is_site_admin(actor_id) then raise exception 'permission denied'; end if;
  select user_id into target_user_id from public.account_recovery_tokens where id=target_token_id;
  if target_user_id is null then return; end if;
  perform 1 from public.profiles where id=target_user_id for update;
  update public.account_recovery_tokens set revoked_at=now() where id=target_token_id and kind='link' and used_at is null and revoked_at is null returning user_id into target_user_id;
  if target_user_id is not null then insert into public.account_security_events(user_id,actor_id,action) values(target_user_id,actor_id,'recovery_revoked'); end if;
end;
$$;

-- A durable operation ID serializes password changes and resets. If the
-- function crashes after claim, the account stays fail-closed until explicit
-- operator abort/recovery. Consumed tokens never become reusable.
create or replace function public.begin_account_password_update(target_user_id uuid default null, recovery_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target_id uuid; recovery public.account_recovery_tokens; operation_id uuid := gen_random_uuid();
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'permission denied'; end if;
  if recovery_hash is not null then
    select user_id into target_id from public.account_recovery_tokens where token_hash=recovery_hash;
  else target_id := target_user_id; end if;
  if target_id is null then raise exception 'invalid recovery'; end if;
  perform 1 from public.profiles where id=target_id and account_status='approved' for update;
  if not found then raise exception 'invalid recovery'; end if;
  insert into public.account_security_state(user_id) values(target_id) on conflict do nothing;
  perform 1 from public.account_security_state where user_id=target_id and pending_operation is null for update;
  if not found then raise exception 'security operation pending'; end if;
  if recovery_hash is not null then
    select * into recovery from public.account_recovery_tokens where token_hash=recovery_hash and used_at is null and revoked_at is null
      and (expires_at is null or expires_at>now()) for update;
    if recovery.id is null then raise exception 'invalid recovery'; end if;
    update public.account_recovery_tokens set used_at=now() where id=recovery.id;
    insert into public.account_security_events(user_id,action) values(target_id,'recovery_used');
  end if;
  update public.account_security_state set pending_operation=operation_id,operation_started_at=clock_timestamp(),sessions_valid_after=clock_timestamp() where user_id=target_id;
  return jsonb_build_object('userId',target_id,'operationId',operation_id,'recovery',recovery_hash is not null);
end;
$$;
create or replace function public.finish_account_password_update(target_user_id uuid, operation_id uuid, succeeded boolean, was_recovery boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'permission denied'; end if;
  perform 1 from public.profiles where id=target_user_id for update;
  update public.account_security_state set pending_operation=case when succeeded then null else pending_operation end,
    operation_started_at=case when succeeded then null else operation_started_at end,sessions_valid_after=clock_timestamp()
    where user_id=target_user_id and pending_operation=operation_id;
  if not found then raise exception 'operation mismatch'; end if;
  -- Failed/uncertain Auth calls stay fail-closed until explicit operator abort.
  -- A delayed Auth write cannot race a newly admitted old-password session.
  update public.account_recovery_tokens set revoked_at=now() where user_id=target_user_id and used_at is null and revoked_at is null;
  insert into public.account_security_events(user_id,actor_id,action) values(target_user_id,case when was_recovery then null else target_user_id end,
    case when not succeeded then 'password_update_failed' when was_recovery then 'password_reset' else 'password_changed' end);
end;
$$;
create or replace function public.abort_account_password_update(target_user_id uuid, actor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' or not public.is_account_approved(actor_id) or not public.is_site_admin(actor_id) or actor_id=target_user_id then raise exception 'permission denied'; end if;
  perform 1 from public.profiles where id=target_user_id for update;
  update public.account_security_state set pending_operation=null,operation_started_at=null,sessions_valid_after=clock_timestamp()
    where user_id=target_user_id and pending_operation is not null and operation_started_at<now()-interval '15 minutes';
  if not found then raise exception 'operation still active'; end if;
  insert into public.account_security_events(user_id,actor_id,action) values(target_user_id,actor_id,'operation_aborted');
end;
$$;
create or replace function public.account_security_overview(target_user_id uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_account_approved(auth.uid()) or (target_user_id<>auth.uid() and not public.is_site_admin(auth.uid())) then raise exception 'permission denied'; end if;
  return jsonb_build_object(
    'username',(select username from public.profiles where id=target_user_id),
    'pendingSince',(select operation_started_at from public.account_security_state where user_id=target_user_id and pending_operation is not null),
    'hasBackup',exists(select 1 from public.account_recovery_tokens where user_id=target_user_id and kind='backup' and used_at is null and revoked_at is null),
    'links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at,'expiresAt',expires_at,'usedAt',used_at,'revokedAt',revoked_at)) from (select * from public.account_recovery_tokens where user_id=target_user_id and kind='link' order by created_at desc limit 10) tokens),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',coalesce(p.display_name,p.username),'previousUsername',e.previous_username,'nextUsername',e.next_username,'createdAt',e.created_at) order by e.created_at desc,e.id desc)
      from (select * from public.account_security_events where user_id=target_user_id order by created_at desc,id desc limit 100) e left join public.profiles p on p.id=e.actor_id),'[]'::jsonb));
end;
$$;

revoke all on function public.reserve_account_username() from public, anon, authenticated;
revoke all on function public.account_session_valid(), public.account_security_overview(uuid) from public, anon;
grant execute on function public.account_session_valid(), public.account_security_overview(uuid) to authenticated;
revoke all on function public.change_account_username(uuid,text), public.issue_account_recovery(uuid,uuid,text,text), public.revoke_account_recovery(uuid,uuid), public.begin_account_password_update(uuid,text), public.finish_account_password_update(uuid,uuid,boolean,boolean), public.abort_account_password_update(uuid,uuid) from public,anon,authenticated;
grant execute on function public.change_account_username(uuid,text), public.issue_account_recovery(uuid,uuid,text,text), public.revoke_account_recovery(uuid,uuid), public.begin_account_password_update(uuid,text), public.finish_account_password_update(uuid,uuid,boolean,boolean), public.abort_account_password_update(uuid,uuid) to service_role;
create or replace function public.purge_account_security_records()
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'permission denied'; end if;
  delete from public.account_security_events where created_at<now()-interval '90 days';
  get diagnostics removed = row_count;
  delete from public.account_recovery_tokens where coalesce(used_at,revoked_at,expires_at)<now()-interval '90 days';
  return removed;
end;
$$;
revoke all on function public.purge_account_security_records() from public,anon,authenticated;
grant execute on function public.purge_account_security_records() to service_role;
commit;
