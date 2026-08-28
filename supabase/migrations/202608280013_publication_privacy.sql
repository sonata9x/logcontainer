-- Publications remain read-only and distinct from Guest collaboration. Password
-- sessions are opaque, versioned and available only through server mediation.

alter table public.publications add column if not exists visibility text not null default 'public';
alter table public.publications add column if not exists password_hash text;
alter table public.publications add column if not exists password_version integer not null default 1;
alter table public.publications drop constraint if exists publications_visibility_check;
alter table public.publications add constraint publications_visibility_check
  check (visibility in ('public', 'password'));
alter table public.publications drop constraint if exists publications_password_check;
alter table public.publications add constraint publications_password_check
  check ((visibility = 'public' and password_hash is null)
    or (visibility = 'password' and password_hash like 'scrypt$%'));

update public.publications set visibility = 'public', password_hash = null
where visibility is null or visibility not in ('public', 'password');

create table if not exists public.publication_sessions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  token_hash text not null unique,
  password_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint publication_sessions_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists publication_sessions_active_idx
on public.publication_sessions(publication_id, password_version, expires_at) where revoked_at is null;
alter table public.publication_sessions enable row level security;
revoke all on table public.publication_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.publication_sessions to service_role;

create or replace function public.get_publication_management(target_page_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.can_publish_resource(target_page_id, auth.uid()) then (
    select jsonb_build_object('id', publication.id, 'pageId', publication.page_id,
      'token', publication.token, 'isActive', publication.is_active,
      'visibility', publication.visibility, 'passwordVersion', publication.password_version,
      'publishedAt', publication.published_at, 'updatedAt', publication.updated_at)
    from public.publications publication where publication.page_id = target_page_id
  ) else null end;
$$;

create or replace function public.configure_publication(
  target_page_id uuid,
  next_token text,
  next_visibility text,
  next_password_hash text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare managed_publication public.publications;
begin
  if not public.can_publish_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if next_token !~ '^[A-Za-z0-9_-]{12}$' then raise exception 'invalid publication token'; end if;
  if next_visibility not in ('public', 'password') then raise exception 'invalid publication visibility'; end if;
  if next_visibility = 'password' and (next_password_hash is null or next_password_hash not like 'scrypt$%')
  then raise exception 'password hash is required'; end if;
  insert into public.publications(page_id, token, is_active, visibility, password_hash,
    password_version, published_at)
  values (target_page_id, next_token, true, next_visibility,
    case when next_visibility = 'password' then next_password_hash else null end, 1, now())
  on conflict (page_id) do update set token = excluded.token, is_active = true,
    visibility = excluded.visibility, password_hash = excluded.password_hash,
    password_version = public.publications.password_version + 1, published_at = now()
  returning * into managed_publication;
  update public.publication_sessions set revoked_at = now()
  where publication_id = managed_publication.id and revoked_at is null;
  return jsonb_build_object('id', managed_publication.id, 'page_id', managed_publication.page_id,
    'token', managed_publication.token, 'is_active', managed_publication.is_active,
    'visibility', managed_publication.visibility, 'password_version', managed_publication.password_version,
    'published_at', managed_publication.published_at, 'updated_at', managed_publication.updated_at);
end;
$$;

create or replace function public.stop_publication(target_page_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare managed_publication public.publications;
begin
  if not public.can_publish_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  update public.publications set is_active = false, password_version = password_version + 1
  where page_id = target_page_id returning * into managed_publication;
  if managed_publication.id is null then return jsonb_build_object('is_active', false); end if;
  update public.publication_sessions set revoked_at = now()
  where publication_id = managed_publication.id and revoked_at is null;
  return jsonb_build_object('id', managed_publication.id, 'page_id', managed_publication.page_id,
    'token', managed_publication.token, 'is_active', false,
    'visibility', managed_publication.visibility, 'password_version', managed_publication.password_version,
    'published_at', managed_publication.published_at, 'updated_at', managed_publication.updated_at);
end;
$$;

create or replace function public.get_published_log(
  publication_token text,
  after_sort_key bigint default null,
  batch_size integer default 300
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
declare bounded_size integer := greatest(1, least(coalesce(batch_size, 300), 300));
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
  select jsonb_build_object(
    'page', jsonb_build_object('id', page.id, 'title', page.title),
    'publishedAt', publication.published_at,
    'totalCount', log.visible_entry_count,
    'entries', coalesce((select jsonb_agg(public.log_entry_dto(entry) order by entry.sort_key)
      from (select row.* from public.log_entries row
        where row.log_id = log.id and row.is_deleted = false
          and (after_sort_key is null or row.sort_key > after_sort_key)
        order by row.sort_key limit bounded_size) entry), '[]'::jsonb)
  ) into result
  from public.publications publication
  join public.pages page on page.id = publication.page_id
  join public.logs log on log.page_id = page.id
  where publication.token = publication_token and publication.is_active
    and page.page_type = 'log' and page.is_archived = false and page.deleted_at is null;
  return result;
end;
$$;

revoke all on function public.get_publication_management(uuid) from public, anon;
revoke all on function public.configure_publication(uuid, text, text, text) from public, anon;
revoke all on function public.stop_publication(uuid) from public, anon;
grant execute on function public.get_publication_management(uuid) to authenticated;
grant execute on function public.configure_publication(uuid, text, text, text) to authenticated;
grant execute on function public.stop_publication(uuid) to authenticated;
revoke execute on function public.get_published_log(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.get_published_log(text, bigint, integer) to service_role;
