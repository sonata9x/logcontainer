-- Guest Page collaboration is distinct from read-only publications. Browser-visible
-- secrets are stored only as SHA-256 hashes; passwords use application-side scrypt.

create table if not exists public.page_share_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null unique references public.pages(id) on delete cascade,
  token_hash text not null unique,
  is_active boolean not null default true,
  default_access_level text not null default 'viewer',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_share_links_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint page_share_links_access_check check (default_access_level in ('viewer', 'editor'))
);

create table if not exists public.guest_participants (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  nickname text not null,
  password_hash text not null,
  access_level text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint guest_participants_nickname_check check (char_length(trim(nickname)) between 2 and 40),
  constraint guest_participants_access_check check (access_level in ('viewer', 'editor')),
  constraint guest_participants_password_check check (password_hash like 'scrypt$%')
);

create unique index if not exists guest_participants_active_nickname_idx
on public.guest_participants(page_id, lower(nickname)) where revoked_at is null;

create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_participant_id uuid not null references public.guest_participants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint guest_sessions_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists guest_sessions_participant_active_idx
on public.guest_sessions(guest_participant_id, expires_at) where revoked_at is null;

alter table public.log_entry_revisions
  add column if not exists guest_participant_id uuid references public.guest_participants(id) on delete set null;

alter table public.page_share_links enable row level security;
alter table public.guest_participants enable row level security;
alter table public.guest_sessions enable row level security;
revoke all on table public.page_share_links from public, anon, authenticated;
revoke all on table public.guest_participants from public, anon, authenticated;
revoke all on table public.guest_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.page_share_links to service_role;
grant select, insert, update, delete on table public.guest_participants to service_role;
grant select, insert, update, delete on table public.guest_sessions to service_role;

create trigger page_share_links_set_updated_at before update on public.page_share_links
for each row execute function public.set_updated_at();

create or replace function public.get_page_share_link_management(target_page_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.can_manage_guest_link(target_page_id, auth.uid()) then jsonb_build_object(
    'link', (select jsonb_build_object('id', link.id, 'isActive', link.is_active,
      'defaultAccessLevel', link.default_access_level, 'createdAt', link.created_at,
      'updatedAt', link.updated_at) from public.page_share_links link where link.page_id = target_page_id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', guest.id, 'nickname', guest.nickname, 'accessLevel', guest.access_level,
      'createdAt', guest.created_at, 'lastSeenAt', guest.last_seen_at
    ) order by guest.created_at) from public.guest_participants guest
      where guest.page_id = target_page_id and guest.revoked_at is null), '[]'::jsonb)
  ) else null end;
$$;

create or replace function public.configure_page_share_link(
  target_page_id uuid,
  next_token_hash text default null,
  next_is_active boolean default null,
  next_default_access_level text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
declare managed_link public.page_share_links;
begin
  if not public.can_manage_guest_link(target_page_id, actor_id) then raise exception 'permission denied'; end if;
  if next_token_hash is not null and next_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid token hash'; end if;
  if next_default_access_level is not null and next_default_access_level not in ('viewer', 'editor')
  then raise exception 'invalid guest access level'; end if;
  if next_token_hash is not null then
    insert into public.page_share_links(page_id, token_hash, is_active, default_access_level, created_by)
    values (target_page_id, next_token_hash, coalesce(next_is_active, true),
      coalesce(next_default_access_level, 'viewer'), actor_id)
    on conflict (page_id) do update set token_hash = excluded.token_hash,
      is_active = excluded.is_active,
      default_access_level = coalesce(next_default_access_level, page_share_links.default_access_level),
      created_by = actor_id
    returning * into managed_link;
  else
    update public.page_share_links set
      is_active = coalesce(next_is_active, is_active),
      default_access_level = coalesce(next_default_access_level, default_access_level)
    where page_id = target_page_id returning * into managed_link;
  end if;
  if managed_link.id is null then raise exception 'guest link not found'; end if;
  if next_token_hash is not null or next_is_active = false then
    update public.guest_sessions session set revoked_at = now()
    from public.guest_participants guest
    where session.guest_participant_id = guest.id and guest.page_id = target_page_id
      and session.revoked_at is null;
  end if;
  return jsonb_build_object('id', managed_link.id, 'isActive', managed_link.is_active,
    'defaultAccessLevel', managed_link.default_access_level,
    'createdAt', managed_link.created_at, 'updatedAt', managed_link.updated_at);
end;
$$;

create or replace function public.manage_guest_participant(
  target_page_id uuid,
  target_guest_participant_id uuid,
  next_access_level text default null,
  should_revoke boolean default false
) returns boolean language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
begin
  if not public.can_manage_guest_link(target_page_id, actor_id) then raise exception 'permission denied'; end if;
  if next_access_level is not null and next_access_level not in ('viewer', 'editor')
  then raise exception 'invalid guest access level'; end if;
  if should_revoke then
    update public.guest_participants set revoked_at = now(), revoked_by = actor_id
    where id = target_guest_participant_id and page_id = target_page_id and revoked_at is null;
    if not found then raise exception 'guest participant not found'; end if;
    update public.guest_sessions set revoked_at = now()
    where guest_participant_id = target_guest_participant_id and revoked_at is null;
  else
    update public.guest_participants set access_level = next_access_level
    where id = target_guest_participant_id and page_id = target_page_id and revoked_at is null;
    if not found then raise exception 'guest participant not found'; end if;
  end if;
  return true;
end;
$$;

create or replace function public.update_guest_page_title(
  target_guest_participant_id uuid, target_page_id uuid, next_title text
) returns text language plpgsql security definer set search_path = public as $$
declare updated_title text;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
  if not exists (select 1 from public.guest_participants guest
    join public.page_share_links link on link.page_id = guest.page_id and link.is_active
    where guest.id = target_guest_participant_id and guest.page_id = target_page_id
      and guest.access_level = 'editor' and guest.revoked_at is null)
  then raise exception 'permission denied'; end if;
  if nullif(trim(next_title), '') is null then raise exception 'title is required'; end if;
  update public.pages set title = left(trim(next_title), 200)
  where id = target_page_id and page_type = 'log' and deleted_at is null
  returning title into updated_title;
  if updated_title is null then raise exception 'page not found'; end if;
  return updated_title;
end;
$$;

create or replace function public.update_guest_log_entry_document(
  target_guest_participant_id uuid, target_page_id uuid, target_entry_id uuid,
  next_document jsonb, next_content text, next_has_image_content boolean default false,
  revision_action text default 'edit', expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
  if not exists (select 1 from public.guest_participants guest
    join public.page_share_links link on link.page_id = guest.page_id and link.is_active
    where guest.id = target_guest_participant_id and guest.page_id = target_page_id
      and guest.access_level = 'editor' and guest.revoked_at is null)
  then raise exception 'permission denied'; end if;
  if next_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select entry.* into target_entry from public.log_entries entry join public.logs log on log.id = entry.log_id
  where entry.id = target_entry_id and log.page_id = target_page_id and entry.is_deleted = false for update;
  if target_entry.id is null or target_entry.document_version <> 2 then raise exception 'entry not found'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another participant'; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, guest_participant_id, action,
    previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, null, target_guest_participant_id, revision_action,
    target_entry.content, next_content, target_entry.document, null, 2);
  update public.log_entries set original_document = coalesce(original_document, document),
    document = next_document, content = next_content,
    entry_type = case when next_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    speaker_name = nullif(next_document#>>'{speaker,name}', ''),
    speaker_color = nullif(next_document#>>'{speaker,color}', ''),
    metadata = metadata || '{"edited": true}'::jsonb, has_image_content = next_has_image_content,
    updated_by = null where id = target_entry.id returning * into target_entry;
  update public.logs set content_version = content_version + 1 where id = target_entry.log_id;
  return public.log_entry_dto(target_entry);
end;
$$;

create or replace function public.update_guest_log_entry_content(
  target_guest_participant_id uuid, target_page_id uuid, target_entry_id uuid,
  next_content text, next_raw_html text, expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
  if not exists (select 1 from public.guest_participants guest
    join public.page_share_links link on link.page_id = guest.page_id and link.is_active
    where guest.id = target_guest_participant_id and guest.page_id = target_page_id
      and guest.access_level = 'editor' and guest.revoked_at is null)
  then raise exception 'permission denied'; end if;
  select entry.* into target_entry from public.log_entries entry join public.logs log on log.id = entry.log_id
  where entry.id = target_entry_id and log.page_id = target_page_id and entry.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another participant'; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, guest_participant_id, action,
    previous_content, next_content)
  values (target_entry.id, null, target_guest_participant_id, 'edit', target_entry.content, next_content);
  update public.log_entries set original_content = coalesce(original_content, content),
    content = next_content, raw_html = next_raw_html,
    metadata = metadata || '{"edited": true}'::jsonb, updated_by = null
  where id = target_entry.id returning * into target_entry;
  update public.logs set content_version = content_version + 1 where id = target_entry.log_id;
  return public.log_entry_dto(target_entry);
end;
$$;

create or replace function public.set_guest_log_entry_deleted(
  target_guest_participant_id uuid, target_page_id uuid, target_entry_id uuid, should_delete boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
  if not exists (select 1 from public.guest_participants guest
    join public.page_share_links link on link.page_id = guest.page_id and link.is_active
    where guest.id = target_guest_participant_id and guest.page_id = target_page_id
      and guest.access_level = 'editor' and guest.revoked_at is null)
  then raise exception 'permission denied'; end if;
  select entry.* into target_entry from public.log_entries entry join public.logs log on log.id = entry.log_id
  where entry.id = target_entry_id and log.page_id = target_page_id for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.is_deleted = should_delete then return public.log_entry_dto(target_entry); end if;
  insert into public.log_entry_revisions(entry_id, editor_id, guest_participant_id, action,
    previous_content, next_content, revision_schema_version)
  values (target_entry.id, null, target_guest_participant_id,
    case when should_delete then 'delete' else 'restore' end,
    target_entry.content, target_entry.content, target_entry.document_version);
  update public.log_entries set is_deleted = should_delete,
    deleted_at = case when should_delete then now() else null end, updated_by = null
  where id = target_entry.id returning * into target_entry;
  update public.logs set content_version = content_version + 1,
    visible_entry_count = greatest(0, visible_entry_count + case when should_delete then -1 else 1 end)
  where id = target_entry.log_id;
  return public.log_entry_dto(target_entry);
end;
$$;

revoke all on function public.get_page_share_link_management(uuid) from public, anon;
revoke all on function public.configure_page_share_link(uuid, text, boolean, text) from public, anon;
revoke all on function public.manage_guest_participant(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.get_page_share_link_management(uuid) to authenticated;
grant execute on function public.configure_page_share_link(uuid, text, boolean, text) to authenticated;
grant execute on function public.manage_guest_participant(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.update_guest_page_title(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.update_guest_log_entry_document(uuid, uuid, uuid, jsonb, text, boolean, text, timestamptz) from public, anon, authenticated;
revoke all on function public.update_guest_log_entry_content(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.set_guest_log_entry_deleted(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.update_guest_page_title(uuid, uuid, text) to service_role;
grant execute on function public.update_guest_log_entry_document(uuid, uuid, uuid, jsonb, text, boolean, text, timestamptz) to service_role;
grant execute on function public.update_guest_log_entry_content(uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.set_guest_log_entry_deleted(uuid, uuid, uuid, boolean) to service_role;
