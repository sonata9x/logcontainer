-- Final authorization and retention polish. Reimport is owner-only at the RPC
-- boundary and canonical baseline text is preserved alongside COW documents.

create or replace function public.preserve_log_entry_original_content()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.is_added = false and new.content is distinct from old.content
    and old.original_content is null
  then new.original_content = old.content; end if;
  return new;
end;
$$;

drop trigger if exists log_entries_preserve_original_content on public.log_entries;
create trigger log_entries_preserve_original_content before update of content on public.log_entries
for each row execute function public.preserve_log_entry_original_content();

create or replace function public.replace_log_entries_v3(
  target_page_id uuid,
  import_id uuid,
  source_storage_path text,
  source_sha256 text,
  source_size_bytes bigint,
  compressed_size_bytes bigint,
  source_platform text,
  report jsonb,
  entries jsonb,
  expected_content_version bigint,
  previous_generation_storage_path text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log public.logs;
declare inserted_count integer;
begin
  if not public.can_reimport_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;
  if target_log.content_version <> expected_content_version then
    raise exception using errcode = '40001', message = 'log changed during import';
  end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'entries must be an array'; end if;
  if source_storage_path is null or source_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid source archive metadata'; end if;
  perform set_config('app.bulk_log_replace', 'true', true);
  insert into public.log_imports(id, log_id, source_html, source_storage_path,
    source_sha256, source_size_bytes, compressed_size_bytes, compression,
    previous_generation_storage_path, report, parsed_snapshot,
    replaced_entries_snapshot, parser_version, imported_by)
  values (import_id, target_log.id, null, source_storage_path, source_sha256,
    source_size_bytes, compressed_size_bytes, 'gzip', previous_generation_storage_path,
    report, null, null, 2, auth.uid());
  update public.logs set original_html = null, platform = source_platform,
    import_report = report, content_version = content_version + 1 where id = target_log.id;
  delete from public.log_entries where log_id = target_log.id;
  insert into public.log_entries(log_id, order_index, sort_key, entry_type,
    speaker_name, speaker_color, content, original_content, raw_html, metadata,
    document_version, document, original_document, has_image_content)
  select target_log.id, item.order_index, item.sort_key, item.entry_type,
    item.speaker_name, item.speaker_color, item.content, item.content, null, '{}'::jsonb,
    2, item.document, null, coalesce(item.has_image_content, false)
  from jsonb_to_recordset(entries) as item(order_index integer, sort_key bigint,
    entry_type text, speaker_name text, speaker_color text, content text,
    document jsonb, has_image_content boolean)
  where item.document->>'version' = '2';
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(entries) then raise exception 'one or more v2 documents were invalid'; end if;
  update public.logs set visible_entry_count = inserted_count where id = target_log.id;
  insert into public.log_change_events(log_id, event_type) values (target_log.id, 'log_replaced');
  return jsonb_build_object('count', inserted_count, 'contentVersion', target_log.content_version + 1);
end;
$$;

create or replace function public.restore_log_original_v2(
  target_page_id uuid,
  restore_event_id uuid,
  generation_storage_path text,
  baseline_contents jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log public.logs;
declare restored_count integer;
declare removed_count integer;
begin
  if not public.can_restore_resource_original(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if nullif(trim(generation_storage_path), '') is null or jsonb_typeof(baseline_contents) <> 'object'
  then raise exception 'restore baseline is required'; end if;
  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;
  if not exists (select 1 from public.log_imports where log_id = target_log.id)
  then raise exception 'import baseline not found'; end if;
  perform set_config('app.bulk_log_replace', 'true', true);
  delete from public.log_entries where log_id = target_log.id and is_added = true;
  get diagnostics removed_count = row_count;
  update public.log_entries entry set
    document = coalesce(entry.original_document, entry.document), original_document = null,
    content = coalesce(baseline_contents->>entry.id::text, entry.original_content, entry.content),
    original_content = coalesce(baseline_contents->>entry.id::text, entry.original_content, entry.content),
    raw_html = case when entry.document_version = 2 then null else entry.raw_html end,
    entry_type = case when coalesce(entry.original_document, entry.document)->>'kind' = 'dialogue'
      then 'dialogue' when entry.document_version = 2 then 'system' else entry.entry_type end,
    speaker_name = case when entry.document_version = 2 then
      nullif(coalesce(entry.original_document, entry.document)#>>'{speaker,name}', '') else entry.speaker_name end,
    speaker_color = case when entry.document_version = 2 then
      nullif(coalesce(entry.original_document, entry.document)#>>'{speaker,color}', '') else entry.speaker_color end,
    metadata = entry.metadata - 'edited' - 'added', is_deleted = false,
    deleted_at = null, updated_by = auth.uid()
  where entry.log_id = target_log.id and entry.is_added = false;
  get diagnostics restored_count = row_count;
  perform set_config('app.bulk_log_replace', 'false', true);
  update public.logs set content_version = content_version + 1,
    visible_entry_count = restored_count where id = target_log.id;
  insert into public.log_restore_events(id, log_id, restored_by, generation_storage_path,
    restored_entry_count, removed_manual_entry_count)
  values (restore_event_id, target_log.id, auth.uid(), generation_storage_path,
    restored_count, removed_count);
  insert into public.log_change_events(log_id, entry_id, event_type)
  values (target_log.id, null, 'log_replaced');
  return jsonb_build_object('restoredCount', restored_count,
    'removedManualCount', removed_count, 'contentVersion', target_log.content_version + 1,
    'restoreEventId', restore_event_id);
end;
$$;

revoke execute on function public.restore_log_original(uuid, uuid, text) from authenticated;
revoke all on function public.restore_log_original_v2(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.restore_log_original_v2(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.purge_expired_external_sessions()
returns integer language plpgsql security definer set search_path = public as $$
declare purged_count integer;
declare next_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
  delete from public.guest_sessions where expires_at < now() or revoked_at < now() - interval '30 days';
  get diagnostics purged_count = row_count;
  delete from public.publication_sessions where expires_at < now() or revoked_at < now() - interval '30 days';
  get diagnostics next_count = row_count;
  return purged_count + next_count;
end;
$$;

revoke all on function public.purge_expired_external_sessions() from public, anon, authenticated;
grant execute on function public.purge_expired_external_sessions() to service_role;
