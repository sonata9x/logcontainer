-- Scoped page-extra writes: resource ownership and placement remain RPC-only.
create or replace function public.update_page_extras(target_page_id uuid, changes jsonb)
returns jsonb language plpgsql security definer
set search_path = public set row_security = off as $$
declare
  saved public.pages%rowtype;
begin
  if auth.uid() is null or not public.can_edit_resource(target_page_id, auth.uid()) then
    raise exception 'Page edit permission required' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'object'
    or changes - array['overview','font_family','session_card_path','session_card_mime','session_card_size'] <> '{}'::jsonb then
    raise exception 'Invalid page extra fields' using errcode = '22023';
  end if;
  select * into saved from public.pages where id = target_page_id
    and page_type = 'log' and deleted_at is null and not is_archived for update;
  if not found then raise exception 'Page unavailable' using errcode = '42501'; end if;
  if changes ? 'session_card_path' and changes->>'session_card_path' is not null
    and (changes->>'session_card_path' not like target_page_id::text || '/%'
      or changes->>'session_card_path' like '%..%') then
    raise exception 'Invalid session card path' using errcode = '22023';
  end if;
  update public.pages set
    overview = case when changes ? 'overview' then changes->>'overview' else overview end,
    font_family = case when changes ? 'font_family' then changes->>'font_family' else font_family end,
    session_card_path = case when changes ? 'session_card_path' then changes->>'session_card_path' else session_card_path end,
    session_card_mime = case when changes ? 'session_card_mime' then changes->>'session_card_mime' else session_card_mime end,
    session_card_size = case when changes ? 'session_card_size' then (changes->>'session_card_size')::integer else session_card_size end
  where id = target_page_id returning * into saved;
  return jsonb_build_object('overview', saved.overview, 'font_family', saved.font_family,
    'session_card_path', saved.session_card_path, 'session_card_mime', saved.session_card_mime,
    'session_card_size', saved.session_card_size);
end;
$$;
revoke all on function public.update_page_extras(uuid, jsonb) from public, anon;
grant execute on function public.update_page_extras(uuid, jsonb) to authenticated;

-- INSERT ... RETURNING must see the new owner's asset without a stable
-- table-reading function using the statement's pre-insert snapshot.
drop policy if exists bgm_assets_select on public.bgm_assets;
create policy bgm_assets_select on public.bgm_assets for select to authenticated
using ((owner_user_id = auth.uid() and deleted_at is null)
  or public.can_access_bgm_asset(id, auth.uid()));
