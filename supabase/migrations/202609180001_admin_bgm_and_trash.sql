begin;
-- Site administration is independent of shared-resource admin permissions.
create or replace function public.admin_bgm_inventory(search_text text default '', page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_account_approved(auth.uid()) or not public.is_site_admin(auth.uid()) then
    raise exception 'permission denied';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.bgm_assets),
    'totalBytes', (select coalesce(sum(byte_size), 0) from public.bgm_assets where source_type = 'upload'),
    'matching', (select count(*) from public.bgm_assets where strpos(lower(canonical_title), lower(coalesce(search_text, ''))) > 0),
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
    where strpos(lower(a.canonical_title), lower(coalesce(search_text, ''))) > 0
    order by a.created_at desc, a.id limit 100 offset greatest(0, page_offset)
  ) assets;
  return result;
end;
$$;

-- Serialize new references with the deletion tombstone. A FK KEY SHARE lock
-- alone does not conflict with changing deleted_at, so explicitly use SHARE.
create or replace function public.guard_live_bgm_reference()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.bgm_assets where id = new.bgm_asset_id and deleted_at is null and is_ready for share;
  if not found then raise exception 'BGM is unavailable'; end if;
  return new;
end;
$$;
drop trigger if exists bgm_library_live_asset on public.bgm_library_items;
drop trigger if exists bgm_playlist_live_asset on public.bgm_playlist_items;
drop trigger if exists page_bgm_live_asset on public.page_bgm_items;
create trigger bgm_library_live_asset before insert or update on public.bgm_library_items for each row execute function public.guard_live_bgm_reference();
create trigger bgm_playlist_live_asset before insert or update on public.bgm_playlist_items for each row execute function public.guard_live_bgm_reference();
create trigger page_bgm_live_asset before insert or update on public.page_bgm_items for each row execute function public.guard_live_bgm_reference();

create or replace function public.prepare_admin_bgm_delete(target_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare asset public.bgm_assets;
begin
  if not public.is_account_approved(auth.uid()) or not public.is_site_admin(auth.uid()) then raise exception 'permission denied'; end if;
  select * into asset from public.bgm_assets where id = target_asset_id for update;
  if asset.id is null then raise exception 'BGM not found'; end if;
  if asset.source_type = 'upload' and (asset.storage_path is null or asset.storage_path !~ ('^' || asset.owner_user_id::text || '/[0-9a-f-]{36}[.]mp3$')) then raise exception 'invalid BGM storage path'; end if;
  -- Signed upload targets can outlive upload completion. Never remove the row
  -- while a recently-issued target may be reused to create an orphan object.
  if asset.source_type = 'upload' and asset.created_at > now() - interval '24 hours' then raise exception 'recent upload is protected for 24 hours'; end if;
  update public.bgm_assets set deleted_at = coalesce(deleted_at, now()) where id = asset.id;
  delete from public.page_bgm_items where bgm_asset_id = asset.id;
  delete from public.bgm_playlist_items where bgm_asset_id = asset.id;
  delete from public.bgm_library_items where bgm_asset_id = asset.id;
  return jsonb_build_object('id', asset.id, 'storagePath', asset.storage_path);
end;
$$;

create or replace function public.guard_bgm_source_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source_type = 'upload' and (new.storage_path is null or new.storage_path !~ ('^' || new.owner_user_id::text || '/[0-9a-f-]{36}[.]mp3$')) then raise exception 'invalid BGM storage path'; end if;
  else
    if row(new.owner_user_id, new.source_type, new.storage_path, new.created_at) is distinct from row(old.owner_user_id, old.source_type, old.storage_path, old.created_at) then raise exception 'BGM source identity is immutable'; end if;
    if old.deleted_at is not null and new.deleted_at is null then raise exception 'deleted BGM cannot be reactivated'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bgm_source_identity on public.bgm_assets;
create trigger bgm_source_identity before insert or update on public.bgm_assets for each row execute function public.guard_bgm_source_identity();

-- Preserve private object paths BEFORE cascades remove their metadata.
-- Failed Storage removal is retryable by the existing protected purge job.
create table if not exists public.storage_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('session-cards','handout-images','roll20-source-archives','log-generation-archives','roll20-import-staging')),
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique(bucket, storage_path)
);
alter table public.storage_deletion_queue enable row level security;
revoke all on public.storage_deletion_queue from public, anon, authenticated;
grant all on public.storage_deletion_queue to service_role;
create or replace function public.enqueue_deleted_private_objects()
returns trigger language plpgsql security definer set search_path = public as $$
declare row_data jsonb := to_jsonb(old);
begin
  if tg_table_name = 'pages' and row_data->>'session_card_path' is not null then
    insert into public.storage_deletion_queue(bucket, storage_path) values ('session-cards', row_data->>'session_card_path') on conflict do nothing;
  elsif tg_table_name = 'handout_images' then
    insert into public.storage_deletion_queue(bucket, storage_path) values ('handout-images', row_data->>'storage_path') on conflict do nothing;
  elsif tg_table_name = 'log_imports' then
    if row_data->>'source_storage_path' is not null then
      insert into public.storage_deletion_queue(bucket, storage_path) values ('roll20-source-archives', row_data->>'source_storage_path') on conflict do nothing;
    end if;
    if row_data->>'previous_generation_storage_path' is not null then
      insert into public.storage_deletion_queue(bucket, storage_path) values ('log-generation-archives', row_data->>'previous_generation_storage_path') on conflict do nothing;
    end if;
  elsif tg_table_name = 'log_import_uploads' then
    insert into public.storage_deletion_queue(bucket, storage_path) values ('roll20-import-staging', row_data->>'storage_path') on conflict do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists pages_private_cleanup on public.pages;
drop trigger if exists handout_images_private_cleanup on public.handout_images;
drop trigger if exists log_imports_private_cleanup on public.log_imports;
drop trigger if exists import_uploads_private_cleanup on public.log_import_uploads;
create trigger pages_private_cleanup before delete on public.pages for each row execute function public.enqueue_deleted_private_objects();
create trigger handout_images_private_cleanup before delete on public.handout_images for each row execute function public.enqueue_deleted_private_objects();
create trigger log_imports_private_cleanup before delete on public.log_imports for each row execute function public.enqueue_deleted_private_objects();
create trigger import_uploads_private_cleanup before delete on public.log_import_uploads for each row execute function public.enqueue_deleted_private_objects();

create or replace function public.empty_resource_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  if not public.is_account_approved(auth.uid()) then raise exception 'permission denied'; end if;
  delete from public.pages where original_owner_id = auth.uid() and deleted_at is not null;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Cascading page deletion also deletes its log. Do not emit an event that
-- references the already-deleted parent log (a foreign-key violation).
create or replace function public.emit_log_entry_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; target_entry_id uuid; change_type text;
begin
  if current_setting('app.bulk_log_replace', true) = 'true' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  target_log_id := coalesce(new.log_id, old.log_id);
  target_entry_id := coalesce(new.id, old.id);
  if tg_op = 'DELETE' and not exists(select 1 from public.logs where id = target_log_id) then return old; end if;
  if tg_op = 'INSERT' then change_type := 'inserted';
  elsif tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.is_deleted and not old.is_deleted) then change_type := 'deleted';
  elsif tg_op = 'UPDATE' and not new.is_deleted and old.is_deleted then change_type := 'restored';
  else change_type := 'updated'; end if;
  insert into public.log_change_events(log_id, entry_id, event_type) values(target_log_id, target_entry_id, change_type);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create or replace function public.empty_log_entry_trash(target_page_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; removed integer;
begin
  if not public.is_account_approved(auth.uid()) or not public.is_original_resource_owner(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id for update;
  delete from public.log_entries where log_id = target_log_id and is_deleted;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.admin_bgm_inventory(text, integer), public.prepare_admin_bgm_delete(uuid), public.empty_resource_trash(), public.empty_log_entry_trash(uuid) from public, anon;
grant execute on function public.admin_bgm_inventory(text, integer), public.prepare_admin_bgm_delete(uuid), public.empty_resource_trash(), public.empty_log_entry_trash(uuid) to authenticated;
revoke all on function public.guard_live_bgm_reference(), public.guard_bgm_source_identity(), public.enqueue_deleted_private_objects(), public.emit_log_entry_change() from public, anon, authenticated;
commit;
