-- BGM management: preserve upload names and make bulk playlist changes atomic.

alter table public.bgm_assets add column if not exists original_filename text;
alter table public.bgm_assets drop constraint if exists bgm_assets_original_filename_length;
alter table public.bgm_assets add constraint bgm_assets_original_filename_length
check (original_filename is null or char_length(original_filename) between 1 and 255);
alter table public.bgm_assets drop constraint if exists bgm_assets_original_filename_source;
alter table public.bgm_assets add constraint bgm_assets_original_filename_source
check (source_type = 'upload' or original_filename is null);

create or replace function public.guard_bgm_source_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source_type = 'upload' and (new.storage_path is null or new.storage_path !~ ('^' || new.owner_user_id::text || '/[0-9a-f-]{36}[.]mp3$')) then raise exception 'invalid BGM storage path'; end if;
  else
    if row(new.owner_user_id, new.source_type, new.storage_path, new.original_filename, new.created_at)
      is distinct from row(old.owner_user_id, old.source_type, old.storage_path, old.original_filename, old.created_at)
      then raise exception 'BGM source identity is immutable'; end if;
    if old.deleted_at is not null and new.deleted_at is null then raise exception 'deleted BGM cannot be reactivated'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_bgm_source_identity() from public, anon, authenticated;

create or replace function public.add_bgm_playlist_items(target_playlist_id uuid, target_asset_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  actor_id uuid := auth.uid();
  requested_count integer;
  inserted_count integer;
  first_order integer;
begin
  if actor_id is null or not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if coalesce(cardinality(target_asset_ids), 0) < 1 or cardinality(target_asset_ids) > 500 then raise exception 'invalid item count'; end if;
  perform 1 from public.bgm_playlists where id = target_playlist_id and user_id = actor_id for update;
  if not found then raise exception 'playlist not found'; end if;

  select count(distinct requested.asset_id) into requested_count from unnest(target_asset_ids) as requested(asset_id);
  if requested_count <> (
    select count(distinct library.bgm_asset_id)
    from public.bgm_library_items library
    join public.bgm_assets asset on asset.id = library.bgm_asset_id and asset.is_ready and asset.deleted_at is null
    where library.user_id = actor_id and library.bgm_asset_id = any(target_asset_ids)
  ) then raise exception 'BGM library access required'; end if;

  select coalesce(max(sort_order) + 1, 0) into first_order
  from public.bgm_playlist_items where playlist_id = target_playlist_id;
  insert into public.bgm_playlist_items(playlist_id, bgm_asset_id, sort_order)
  select target_playlist_id, requested.asset_id, first_order + requested.position - 1
  from (
    select asset_id, min(position)::integer position
    from unnest(target_asset_ids) with ordinality requested(asset_id, position)
    group by asset_id
  ) requested
  order by requested.position
  on conflict (playlist_id, bgm_asset_id) do nothing;
  get diagnostics inserted_count = row_count;
  return jsonb_build_object('addedCount', inserted_count, 'existingCount', requested_count - inserted_count);
end;
$$;

create or replace function public.reorder_bgm_playlist_items(target_playlist_id uuid, target_item_ids uuid[])
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare
  actor_id uuid := auth.uid();
  item_count integer;
begin
  if actor_id is null or not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  perform 1 from public.bgm_playlists where id = target_playlist_id and user_id = actor_id for update;
  if not found then raise exception 'playlist not found'; end if;
  select count(*) into item_count from public.bgm_playlist_items where playlist_id = target_playlist_id;
  if coalesce(cardinality(target_item_ids), 0) <> item_count
    or (select count(distinct ordered.item_id) from unnest(target_item_ids) as ordered(item_id)) <> item_count
    or exists (
      select 1 from unnest(target_item_ids) as ordered(item_id)
      where not exists (
        select 1 from public.bgm_playlist_items item
        where item.id = ordered.item_id and item.playlist_id = target_playlist_id
      )
    ) then raise exception 'playlist order does not match current items'; end if;
  update public.bgm_playlist_items item set sort_order = ordered.position - 1
  from unnest(target_item_ids) with ordinality ordered(item_id, position)
  where item.id = ordered.item_id and item.playlist_id = target_playlist_id;
end;
$$;

revoke all on function public.add_bgm_playlist_items(uuid, uuid[]), public.reorder_bgm_playlist_items(uuid, uuid[]) from public, anon;
grant execute on function public.add_bgm_playlist_items(uuid, uuid[]), public.reorder_bgm_playlist_items(uuid, uuid[]) to authenticated;
