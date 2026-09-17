-- One waiting track per page. Audio assets and personal libraries are retained.
begin;
lock table public.page_bgm_items in share row exclusive mode;

-- Existing pages keep the most recently attached waiting track.
with ranked as (
  select id, row_number() over (
    partition by page_id order by created_at desc, sort_order desc, id desc
  ) as rank from public.page_bgm_items where role = 'waiting'
)
delete from public.page_bgm_items item using ranked
where item.id = ranked.id and ranked.rank > 1;

create unique index if not exists page_bgm_one_waiting_idx
on public.page_bgm_items(page_id) where role = 'waiting';

create or replace function public.set_page_waiting_bgm(
  target_page_id uuid, target_asset_id uuid, target_custom_title text default null
)
returns jsonb language plpgsql security definer
set search_path = public set row_security = off as $$
declare
  actor_id uuid := auth.uid();
  saved public.page_bgm_items%rowtype;
  asset_json jsonb;
begin
  if actor_id is null or not public.can_edit_resource(target_page_id, actor_id) then
    raise exception 'Page edit permission required' using errcode = '42501';
  end if;
  -- Serialize replacements, including when there is no waiting row yet.
  perform 1 from public.pages where id = target_page_id and page_type = 'log'
    and deleted_at is null and not is_archived for update;
  if not found then raise exception 'Page unavailable' using errcode = '42501'; end if;
  if not public.can_access_bgm_asset(target_asset_id, actor_id) then
    raise exception 'BGM access permission required' using errcode = '42501';
  end if;
  select jsonb_build_object('id', id, 'source_type', source_type,
    'canonical_title', canonical_title, 'youtube_video_id', youtube_video_id,
    'duration_seconds', duration_seconds, 'mime_type', mime_type, 'byte_size', byte_size)
  into asset_json from public.bgm_assets where id = target_asset_id
    and is_ready and deleted_at is null for share;
  if not found then raise exception 'BGM unavailable' using errcode = '22023'; end if;

  -- Atomic replacement: any insertion/trigger failure restores the previous row.
  delete from public.page_bgm_items where page_id = target_page_id and role = 'waiting';
  insert into public.page_bgm_items(page_id, bgm_asset_id, role, entry_id,
    sort_order, custom_title, created_by)
  values (target_page_id, target_asset_id, 'waiting', null, 0,
    nullif(left(btrim(target_custom_title), 200), ''), actor_id)
  returning * into saved;
  return (to_jsonb(saved) - 'created_by') || jsonb_build_object('asset', asset_json);
end;
$$;
revoke all on function public.set_page_waiting_bgm(uuid, uuid, text) from public, anon;
grant execute on function public.set_page_waiting_bgm(uuid, uuid, text) to authenticated;
commit;
