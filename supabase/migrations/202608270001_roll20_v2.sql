alter table public.log_entries add column if not exists document_version integer;
alter table public.log_entries add column if not exists document jsonb;
alter table public.log_entries add column if not exists original_document jsonb;

alter table public.log_entry_revisions add column if not exists previous_snapshot jsonb;
alter table public.log_entry_revisions add column if not exists next_snapshot jsonb;
alter table public.log_entry_revisions add column if not exists revision_schema_version integer;

alter table public.log_imports add column if not exists parsed_snapshot jsonb;
alter table public.log_imports add column if not exists replaced_entries_snapshot jsonb;

create or replace function public.replace_log_entries_v2(
  target_page_id uuid,
  source_html text,
  source_platform text,
  report jsonb,
  entries jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare target_log_id uuid;
declare inserted_count integer;
declare replaced_snapshot jsonb;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'entries must be an array'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entry', to_jsonb(e),
    'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.log_entry_revisions r where r.entry_id = e.id), '[]'::jsonb)
  ) order by e.order_index), '[]'::jsonb)
  into replaced_snapshot
  from public.log_entries e where e.log_id = target_log_id;

  insert into public.log_imports(log_id, source_html, report, imported_by, parsed_snapshot, replaced_entries_snapshot)
  values (target_log_id, source_html, report, auth.uid(), entries, replaced_snapshot);
  update public.logs set original_html = source_html, platform = source_platform, import_report = report where id = target_log_id;
  delete from public.log_entries where log_id = target_log_id;

  insert into public.log_entries(
    log_id, order_index, entry_type, speaker_name, speaker_color, content, original_content, raw_html, metadata,
    document_version, document, original_document
  )
  select target_log_id, item.order_index, item.entry_type, item.speaker_name, item.speaker_color,
    item.content, item.original_content, null, coalesce(item.metadata, '{}'::jsonb), 2, item.document, item.original_document
  from jsonb_to_recordset(entries) as item(
    order_index integer, entry_type text, speaker_name text, speaker_color text, content text,
    original_content text, metadata jsonb, document jsonb, original_document jsonb
  )
  where item.document->>'version' = '2' and item.original_document->>'version' = '2';

  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(entries) then raise exception 'one or more v2 documents were invalid'; end if;
  return inserted_count;
end;
$$;

create or replace function public.update_log_entry_document_v2(
  target_page_id uuid,
  target_entry_id uuid,
  next_document jsonb,
  next_content text,
  revision_action text default 'edit',
  expected_updated_at timestamptz default null
)
returns public.log_entries
language plpgsql
security definer
set search_path = public
as $$
declare target_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  if next_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id and e.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.document_version <> 2 then raise exception 'entry is not v2'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another member';
  end if;

  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), revision_action, target_entry.content, next_content, target_entry.document, next_document, 2);
  update public.log_entries set document = next_document, content = next_content,
    entry_type = case when next_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    speaker_name = nullif(next_document#>>'{speaker,name}', ''), speaker_color = nullif(next_document#>>'{speaker,color}', ''),
    metadata = metadata || '{"edited": true}'::jsonb, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

create or replace function public.create_log_entry_v2(
  target_page_id uuid,
  after_entry_id uuid,
  new_document jsonb,
  new_content text
)
returns public.log_entries
language plpgsql
security definer
set search_path = public
as $$
declare target_log_id uuid;
declare insert_index integer;
declare created_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  if new_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  if after_entry_id is null then
    select coalesce(max(order_index), -1) + 1 into insert_index from public.log_entries where log_id = target_log_id;
  else
    select order_index + 1 into insert_index from public.log_entries where id = after_entry_id and log_id = target_log_id;
    if insert_index is null then raise exception 'previous entry not found'; end if;
    set constraints log_entries_log_order_key deferred;
    update public.log_entries set order_index = order_index + 1 where log_id = target_log_id and order_index >= insert_index;
  end if;
  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, speaker_color, content, original_content, raw_html, metadata, is_added, updated_by, document_version, document, original_document)
  values (target_log_id, insert_index, case when new_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    nullif(new_document#>>'{speaker,name}', ''), nullif(new_document#>>'{speaker,color}', ''), new_content, new_content, null,
    '{"added": true, "parserVersion": 2}'::jsonb, true, auth.uid(), 2, new_document, new_document)
  returning * into created_entry;
  return created_entry;
end;
$$;

create or replace function public.set_log_entry_deleted_v2(target_page_id uuid, target_entry_id uuid, should_delete boolean)
returns public.log_entries
language plpgsql
security definer
set search_path = public
as $$
declare target_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id where e.id = target_entry_id and l.page_id = target_page_id for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.is_deleted = should_delete then return target_entry; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), case when should_delete then 'delete' else 'restore' end, target_entry.content, target_entry.content, target_entry.document, target_entry.document, target_entry.document_version);
  update public.log_entries set is_deleted = should_delete, deleted_at = case when should_delete then now() else null end, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

revoke execute on function public.replace_log_entries_v2(uuid, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.update_log_entry_document_v2(uuid, uuid, jsonb, text, text, timestamptz) from public, anon;
revoke execute on function public.create_log_entry_v2(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.set_log_entry_deleted_v2(uuid, uuid, boolean) from public, anon;
grant execute on function public.replace_log_entries_v2(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.update_log_entry_document_v2(uuid, uuid, jsonb, text, text, timestamptz) to authenticated;
grant execute on function public.create_log_entry_v2(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.set_log_entry_deleted_v2(uuid, uuid, boolean) to authenticated;
