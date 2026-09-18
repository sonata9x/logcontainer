begin;
-- New accounts and untouched historical defaults are monochrome. Preserve
-- existing customized colors, including blue with a prior settings update.
alter table public.user_preferences alter column accent_color set default '#62625F';
update public.user_preferences set accent_color = '#62625F'
where upper(accent_color) = '#4F6BED' and updated_at = created_at;

create or replace function public.bgm_matches_usage_filter(target_asset_id uuid, usage_filter text)
returns boolean language sql stable set search_path = public as $$
  select case usage_filter
    when 'all' then true
    when 'no-page' then not exists(select 1 from public.page_bgm_items where bgm_asset_id = target_asset_id)
    when 'library-only' then
      not exists(select 1 from public.page_bgm_items where bgm_asset_id = target_asset_id)
      and not exists(select 1 from public.bgm_playlist_items where bgm_asset_id = target_asset_id)
      and exists(select 1 from public.bgm_library_items where bgm_asset_id = target_asset_id)
    when 'unreferenced' then
      not exists(select 1 from public.page_bgm_items where bgm_asset_id = target_asset_id)
      and not exists(select 1 from public.bgm_playlist_items where bgm_asset_id = target_asset_id)
      and not exists(select 1 from public.bgm_library_items where bgm_asset_id = target_asset_id)
    else false end;
$$;
-- Remove the old overload: PostgREST must resolve one unambiguous signature.
drop function if exists public.admin_bgm_inventory(text, integer);
create or replace function public.admin_bgm_inventory(search_text text default '', page_offset integer default 0, usage_filter text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_account_approved(auth.uid()) or not public.is_site_admin(auth.uid()) then
    raise exception 'permission denied';
  end if;
  if usage_filter not in ('all','no-page','library-only','unreferenced') then raise exception 'invalid usage filter'; end if;
  select jsonb_build_object(
    'total', (select count(*) from public.bgm_assets),
    'totalBytes', (select coalesce(sum(byte_size), 0) from public.bgm_assets where source_type = 'upload'),
    'matching', (select count(*) from public.bgm_assets where strpos(lower(canonical_title), lower(coalesce(search_text, ''))) > 0 and public.bgm_matches_usage_filter(id, usage_filter)),
    'assets', coalesce(jsonb_agg(item), '[]'::jsonb)
  ) into result from (
    select jsonb_build_object(
      'id', a.id, 'title', a.canonical_title, 'sourceType', a.source_type,
      'byteSize', a.byte_size, 'ready', a.is_ready, 'deletedAt', a.deleted_at, 'createdAt', a.created_at,
      'owner', (select coalesce(p.display_name, p.username) from public.profiles p where p.id = a.owner_user_id),
      'pages', (select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'deleted', p.deleted_at is not null, 'role', u.role, 'entryDeleted', coalesce(e.is_deleted, false))), '[]'::jsonb)
        from public.page_bgm_items u join public.pages p on p.id = u.page_id left join public.log_entries e on e.id = u.entry_id where u.bgm_asset_id = a.id),
      'playlists', (select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'owner', coalesce(owner.display_name, owner.username))), '[]'::jsonb)
        from public.bgm_playlist_items u join public.bgm_playlists p on p.id = u.playlist_id left join public.profiles owner on owner.id = p.user_id where u.bgm_asset_id = a.id),
      'libraries', (select coalesce(jsonb_agg(coalesce(p.display_name, p.username)), '[]'::jsonb)
        from public.bgm_library_items u join public.profiles p on p.id = u.user_id where u.bgm_asset_id = a.id)
    ) item from public.bgm_assets a
    where strpos(lower(a.canonical_title), lower(coalesce(search_text, ''))) > 0 and public.bgm_matches_usage_filter(a.id, usage_filter)
    order by a.created_at desc, a.id limit 100 offset greatest(0, page_offset)
  ) assets;
  return result;
end;
$$;

create or replace function public.update_bgm_library_details(
  target_library_id uuid, next_title text, next_video_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare asset public.bgm_assets; asset_id uuid; source_changed boolean := false;
begin
  if not public.is_account_approved(auth.uid()) then raise exception 'permission denied'; end if;
  if next_title is null or char_length(trim(next_title)) not between 1 and 200 then raise exception 'invalid title'; end if;
  if next_video_id is not null and next_video_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'invalid YouTube video'; end if;
  select bgm_asset_id into asset_id from public.bgm_library_items where id = target_library_id and user_id = auth.uid();
  if asset_id is null then raise exception 'library item not found'; end if;
  -- Same lock order as administrator deletion: asset first, library second.
  select * into asset from public.bgm_assets where id = asset_id and is_ready and deleted_at is null for update;
  if asset.id is null then raise exception 'BGM unavailable'; end if;
  perform 1 from public.bgm_library_items where id = target_library_id and user_id = auth.uid() and bgm_asset_id = asset.id for update;
  if not found then raise exception 'library item changed'; end if;
  if next_video_id is not null then
    if asset.source_type <> 'youtube' then raise exception 'only YouTube links can be edited'; end if;
    if asset.owner_user_id <> auth.uid() and not public.is_site_admin(auth.uid()) then raise exception 'only source owner or site administrator may edit the link'; end if;
    source_changed := asset.youtube_video_id is distinct from next_video_id;
    if source_changed then
      update public.bgm_assets set youtube_video_id = next_video_id,
        youtube_url = 'https://www.youtube.com/watch?v=' || next_video_id where id = asset.id;
    end if;
  end if;
  update public.bgm_library_items set custom_title = trim(next_title) where id = target_library_id and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'assetId', asset.id, 'sourceUpdated', source_changed);
end;
$$;
revoke all on function public.bgm_matches_usage_filter(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_bgm_inventory(text, integer, text), public.update_bgm_library_details(uuid, text, text) from public, anon;
grant execute on function public.admin_bgm_inventory(text, integer, text), public.update_bgm_library_details(uuid, text, text) to authenticated;
commit;
