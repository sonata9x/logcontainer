-- Split reimport into full HTML refresh and cumulative append.
-- Append stores the new full source archive while preserving existing edits/manual blocks.

create or replace function public.append_log_entries_v1(
  target_page_id uuid,
  import_id uuid,
  source_storage_path text,
  source_sha256 text,
  source_size_bytes bigint,
  compressed_size_bytes bigint,
  source_platform text,
  report jsonb,
  entries jsonb,
  cleanup_entry_ids uuid[],
  expected_content_version bigint,
  previous_generation_storage_path text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log public.logs;
declare inserted_count integer;
declare cleaned_count integer;
declare visible_count integer;
declare last_sort_key bigint;
declare last_order_index integer;
begin
  if not public.can_reimport_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;
  if target_log.content_version <> expected_content_version then
    raise exception using errcode = '40001', message = 'log changed during import';
  end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) < 1 then raise exception 'entries must be a non-empty array'; end if;
  if source_storage_path is null or source_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid source archive metadata'; end if;
  if coalesce(array_length(cleanup_entry_ids, 1), 0) <> (
    select count(*) from public.log_entries
    where log_id = target_log.id and id = any(coalesce(cleanup_entry_ids, '{}'::uuid[])) and is_added = false
  ) then raise exception 'invalid cleanup entries'; end if;

  perform set_config('app.bulk_log_replace', 'true', true);
  insert into public.log_imports(
    id, log_id, source_html, source_storage_path, source_sha256, source_size_bytes,
    compressed_size_bytes, compression, previous_generation_storage_path,
    report, parsed_snapshot, replaced_entries_snapshot, parser_version, imported_by
  ) values (
    import_id, target_log.id, null, source_storage_path, source_sha256, source_size_bytes,
    compressed_size_bytes, 'gzip', previous_generation_storage_path,
    report, null, null, coalesce((report->>'parserVersion')::integer, 2), auth.uid()
  );

  delete from public.log_entries
  where log_id = target_log.id and id = any(coalesce(cleanup_entry_ids, '{}'::uuid[])) and is_added = false;
  get diagnostics cleaned_count = row_count;

  select coalesce(max(sort_key), 0), coalesce(max(order_index), -1)
  into last_sort_key, last_order_index from public.log_entries where log_id = target_log.id;

  insert into public.log_entries(
    log_id, order_index, sort_key, entry_type, speaker_name, speaker_color,
    content, original_content, raw_html, metadata, document_version, document,
    original_document, has_image_content
  )
  select target_log.id, last_order_index + item.ordinality::integer,
    last_sort_key + item.ordinality::bigint * 1000000,
    item.value->>'entry_type', nullif(item.value->>'speaker_name', ''),
    nullif(item.value->>'speaker_color', ''), item.value->>'content',
    null, null, '{}'::jsonb, 2, item.value->'document', null,
    coalesce((item.value->>'has_image_content')::boolean, false)
  from jsonb_array_elements(entries) with ordinality as item(value, ordinality)
  where item.value->'document'->>'version' = '2';
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(entries) then raise exception 'one or more v2 documents were invalid'; end if;

  select count(*) into visible_count from public.log_entries
  where log_id = target_log.id and is_deleted = false;
  update public.logs set original_html = null, platform = source_platform,
    import_report = report, content_version = content_version + 1,
    visible_entry_count = visible_count
  where id = target_log.id;
  perform set_config('app.bulk_log_replace', 'false', true);
  insert into public.log_change_events(log_id, event_type) values (target_log.id, 'log_replaced');

  return jsonb_build_object(
    'count', visible_count,
    'appendedCount', inserted_count,
    'cleanedCount', cleaned_count,
    'contentVersion', target_log.content_version + 1
  );
end;
$$;

revoke all on function public.append_log_entries_v1(uuid, uuid, text, text, bigint, bigint, text, jsonb, jsonb, uuid[], bigint, text) from public, anon;
grant execute on function public.append_log_entries_v1(uuid, uuid, text, text, bigint, bigint, text, jsonb, jsonb, uuid[], bigint, text) to authenticated;
