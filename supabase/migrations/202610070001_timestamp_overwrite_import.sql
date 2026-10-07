-- Owner-only Roll20 timestamp refresh. Matching is rechecked in SQL and only
-- canonical timestamp fields are changed; all authored content stays intact.

create or replace function public.overwrite_log_entry_timestamps_v1(
  target_page_id uuid,
  import_id uuid,
  source_storage_path text,
  source_sha256 text,
  source_size_bytes bigint,
  compressed_size_bytes bigint,
  source_platform text,
  report jsonb,
  updates jsonb,
  expected_content_version bigint,
  previous_generation_storage_path text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log public.logs;
declare requested_count integer;
declare distinct_count integer;
declare matched_count integer;
declare updated_count integer;
begin
  if not public.can_reimport_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;
  if target_log.content_version <> expected_content_version then
    raise exception using errcode = '40001', message = 'log changed during import';
  end if;
  if source_platform <> 'roll20' then raise exception 'timestamp overwrite requires roll20'; end if;
  if jsonb_typeof(updates) <> 'array' or jsonb_array_length(updates) < 1 then raise exception 'updates must be a non-empty array'; end if;
  if source_storage_path is null or source_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid source archive metadata'; end if;

  select count(*), count(distinct item.entry_id) into requested_count, distinct_count
  from jsonb_to_recordset(updates) as item(
    entry_id uuid, message_id text, next_timestamp jsonb, next_timestamp_explicit boolean
  );
  if requested_count <> distinct_count then raise exception 'duplicate timestamp update entries'; end if;
  if exists (
    select 1 from jsonb_to_recordset(updates) as item(
      entry_id uuid, message_id text, next_timestamp jsonb, next_timestamp_explicit boolean
    ) where item.entry_id is null or nullif(item.message_id, '') is null
      or item.next_timestamp is null or jsonb_typeof(item.next_timestamp) <> 'object'
      or not (item.next_timestamp ? 'raw') or not (item.next_timestamp ? 'iso')
      or jsonb_typeof(item.next_timestamp->'raw') not in ('string', 'null')
      or jsonb_typeof(item.next_timestamp->'iso') not in ('string', 'null')
      or item.next_timestamp_explicit is null
  ) then raise exception 'invalid timestamp update'; end if;

  select count(*) into matched_count
  from jsonb_to_recordset(updates) as item(
    entry_id uuid, message_id text, next_timestamp jsonb, next_timestamp_explicit boolean
  ) join public.log_entries entry on entry.id = item.entry_id
  where entry.log_id = target_log.id and entry.document_version = 2
    and entry.is_added = false and entry.document#>>'{source,messageId}' = item.message_id;
  if matched_count <> requested_count then raise exception 'timestamp update identity mismatch'; end if;

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

  insert into public.log_entry_revisions(
    entry_id, editor_id, action, previous_content, next_content,
    previous_snapshot, next_snapshot, revision_schema_version
  )
  select entry.id, auth.uid(), 'edit', entry.content, entry.content, entry.document,
    entry.document || jsonb_build_object(
      'timestamp', item.next_timestamp,
      'presentation', coalesce(entry.document->'presentation', '{}'::jsonb)
        || jsonb_build_object('timestampExplicit', item.next_timestamp_explicit)
    ), 2
  from jsonb_to_recordset(updates) as item(
    entry_id uuid, message_id text, next_timestamp jsonb, next_timestamp_explicit boolean
  ) join public.log_entries entry on entry.id = item.entry_id and entry.log_id = target_log.id;

  update public.log_entries entry set
    original_document = coalesce(entry.original_document, entry.document),
    document = entry.document || jsonb_build_object(
      'timestamp', item.next_timestamp,
      'presentation', coalesce(entry.document->'presentation', '{}'::jsonb)
        || jsonb_build_object('timestampExplicit', item.next_timestamp_explicit)
    ),
    updated_by = auth.uid()
  from jsonb_to_recordset(updates) as item(
    entry_id uuid, message_id text, next_timestamp jsonb, next_timestamp_explicit boolean
  ) where entry.id = item.entry_id and entry.log_id = target_log.id;
  get diagnostics updated_count = row_count;
  if updated_count <> requested_count then raise exception 'timestamp update count mismatch'; end if;

  update public.logs set original_html = null, platform = source_platform,
    import_report = report, content_version = content_version + 1
  where id = target_log.id;
  perform set_config('app.bulk_log_replace', 'false', true);
  insert into public.log_change_events(log_id, event_type) values (target_log.id, 'log_replaced');

  return jsonb_build_object(
    'count', target_log.visible_entry_count,
    'updatedCount', updated_count,
    'contentVersion', target_log.content_version + 1
  );
end;
$$;

revoke all on function public.overwrite_log_entry_timestamps_v1(uuid, uuid, text, text, bigint, bigint, text, jsonb, jsonb, bigint, text) from public, anon;
grant execute on function public.overwrite_log_entry_timestamps_v1(uuid, uuid, text, text, bigint, bigint, text, jsonb, jsonb, bigint, text) to authenticated;
