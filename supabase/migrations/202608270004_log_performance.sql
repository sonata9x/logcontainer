-- Log storage/runtime performance hardening. Legacy columns remain during migration.

alter table public.logs add column if not exists content_version bigint not null default 0;
alter table public.logs add column if not exists visible_entry_count integer not null default 0;

alter table public.log_imports alter column source_html drop not null;
alter table public.log_imports add column if not exists source_storage_path text;
alter table public.log_imports add column if not exists source_sha256 text;
alter table public.log_imports add column if not exists source_size_bytes bigint;
alter table public.log_imports add column if not exists compressed_size_bytes bigint;
alter table public.log_imports add column if not exists compression text;
alter table public.log_imports add column if not exists previous_generation_storage_path text;
alter table public.log_imports add column if not exists parser_version integer;

do $$ begin
  alter table public.log_imports add constraint log_imports_compression_check
    check (compression is null or compression = 'gzip');
exception when duplicate_object then null;
end $$;

alter table public.log_entries alter column original_content drop not null;
alter table public.log_entries alter column original_content drop default;
alter table public.log_entries add column if not exists sort_key bigint;
alter table public.log_entries add column if not exists has_image_content boolean not null default false;

update public.log_entries
set sort_key = order_index::bigint * 1000000
where sort_key is null;

alter table public.log_entries alter column sort_key set not null;

update public.logs l
set visible_entry_count = counts.visible_count
from (
  select log_id, count(*) filter (where is_deleted = false)::integer as visible_count
  from public.log_entries group by log_id
) counts
where counts.log_id = l.id;

create unique index if not exists log_entries_log_sort_key_idx
on public.log_entries(log_id, sort_key);
create index if not exists log_entries_visible_cursor_idx
on public.log_entries(log_id, sort_key) where is_deleted = false;
create index if not exists log_entries_trash_idx
on public.log_entries(log_id, deleted_at desc) where is_deleted = true;
create index if not exists pages_owner_deleted_idx
on public.pages(original_owner_id, deleted_at);
create index if not exists profiles_status_created_idx
on public.profiles(account_status, created_at);
create index if not exists workspace_members_user_created_idx
on public.workspace_members(user_id, created_at desc);

insert into storage.buckets(id, name, public)
values ('roll20-source-archives', 'roll20-source-archives', false),
       ('log-generation-archives', 'log-generation-archives', false)
on conflict (id) do update set public = false;

create table if not exists public.log_change_events (
  id bigint generated always as identity primary key,
  log_id uuid not null references public.logs(id) on delete cascade,
  entry_id uuid,
  event_type text not null check (event_type in ('inserted', 'updated', 'deleted', 'restored', 'log_replaced')),
  updated_at timestamptz not null default now()
);

create index if not exists log_change_events_log_id_idx
on public.log_change_events(log_id, id desc);

alter table public.log_change_events enable row level security;
drop policy if exists "resource viewers read log change events" on public.log_change_events;
create policy "resource viewers read log change events" on public.log_change_events for select to authenticated
using (exists (
  select 1 from public.logs l
  where l.id = log_change_events.log_id and public.can_view_resource(l.page_id, auth.uid())
));

create or replace function public.emit_log_entry_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_log_id uuid;
declare target_entry_id uuid;
declare change_type text;
begin
  if current_setting('app.bulk_log_replace', true) = 'true' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  target_log_id := coalesce(new.log_id, old.log_id);
  target_entry_id := coalesce(new.id, old.id);
  if tg_op = 'INSERT' then change_type := 'inserted';
  elsif tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.is_deleted and not old.is_deleted) then change_type := 'deleted';
  elsif tg_op = 'UPDATE' and not new.is_deleted and old.is_deleted then change_type := 'restored';
  else change_type := 'updated';
  end if;
  insert into public.log_change_events(log_id, entry_id, event_type)
  values (target_log_id, target_entry_id, change_type);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists log_entries_emit_change on public.log_entries;
create trigger log_entries_emit_change
after insert or update or delete on public.log_entries
for each row execute function public.emit_log_entry_change();

alter table public.log_entries replica identity default;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'log_change_events'
  ) then
    alter publication supabase_realtime add table public.log_change_events;
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'log_entries'
  ) then
    alter publication supabase_realtime drop table public.log_entries;
  end if;
end $$;

create or replace function public.log_entry_dto(entry public.log_entries)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', entry.id,
    'log_id', entry.log_id,
    'order_index', entry.order_index,
    'sort_key', entry.sort_key,
    'entry_type', entry.entry_type,
    'speaker_name', entry.speaker_name,
    'speaker_color', entry.speaker_color,
    'content', entry.content,
    'raw_html', entry.raw_html,
    'document_version', entry.document_version,
    'document', entry.document,
    'has_image_content', entry.has_image_content,
    'is_deleted', entry.is_deleted,
    'deleted_at', entry.deleted_at,
    'is_added', entry.is_added,
    'updated_by', entry.updated_by,
    'created_at', entry.created_at,
    'updated_at', entry.updated_at
  );
$$;

create or replace function public.get_log_entries_page(
  target_page_id uuid,
  after_sort_key bigint default null,
  batch_size integer default 200
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare target_log_id uuid;
declare total_count integer;
declare bounded_size integer := greatest(1, least(coalesce(batch_size, 200), 300));
declare result_entries jsonb;
begin
  if not public.can_view_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select id, visible_entry_count into target_log_id, total_count from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  select coalesce(jsonb_agg(public.log_entry_dto(e) order by e.sort_key), '[]'::jsonb)
  into result_entries
  from (
    select * from public.log_entries
    where log_id = target_log_id and is_deleted = false
      and (after_sort_key is null or sort_key > after_sort_key)
    order by sort_key limit bounded_size
  ) e;
  return jsonb_build_object('entries', result_entries, 'batchSize', bounded_size, 'totalCount', total_count);
end;
$$;

create or replace function public.get_log_entry_dto(target_page_id uuid, target_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_view_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e
  join public.logs l on l.id = e.log_id
  where l.page_id = target_page_id and e.id = target_entry_id;
  if target_entry.id is null then return null; end if;
  return public.log_entry_dto(target_entry);
end;
$$;

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
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;
  if target_log.content_version <> expected_content_version then
    raise exception using errcode = '40001', message = 'log changed during import';
  end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'entries must be an array'; end if;
  if source_storage_path is null or source_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid source archive metadata'; end if;

  perform set_config('app.bulk_log_replace', 'true', true);
  insert into public.log_imports(
    id, log_id, source_html, source_storage_path, source_sha256, source_size_bytes,
    compressed_size_bytes, compression, previous_generation_storage_path,
    report, parsed_snapshot, replaced_entries_snapshot, parser_version, imported_by
  ) values (
    import_id, target_log.id, null, source_storage_path, source_sha256, source_size_bytes,
    compressed_size_bytes, 'gzip', previous_generation_storage_path,
    report, null, null, 2, auth.uid()
  );
  update public.logs set original_html = null, platform = source_platform,
    import_report = report, content_version = content_version + 1
  where id = target_log.id;
  delete from public.log_entries where log_id = target_log.id;
  insert into public.log_entries(
    log_id, order_index, sort_key, entry_type, speaker_name, speaker_color,
    content, original_content, raw_html, metadata, document_version, document,
    original_document, has_image_content
  )
  select target_log.id, item.order_index, item.sort_key, item.entry_type,
    item.speaker_name, item.speaker_color, item.content, null, null, '{}'::jsonb,
    2, item.document, null, coalesce(item.has_image_content, false)
  from jsonb_to_recordset(entries) as item(
    order_index integer, sort_key bigint, entry_type text, speaker_name text,
    speaker_color text, content text, document jsonb, has_image_content boolean
  )
  where item.document->>'version' = '2';
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(entries) then raise exception 'one or more v2 documents were invalid'; end if;
  update public.logs set visible_entry_count = inserted_count where id = target_log.id;
  insert into public.log_change_events(log_id, event_type) values (target_log.id, 'log_replaced');
  return jsonb_build_object('count', inserted_count, 'contentVersion', target_log.content_version + 1);
end;
$$;

create or replace function public.update_log_entry_document_v3(
  target_page_id uuid, target_entry_id uuid, next_document jsonb, next_content text,
  next_has_image_content boolean default false,
  revision_action text default 'edit', expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if next_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id and e.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.document_version <> 2 then raise exception 'entry is not v2'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another member';
  end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content,
    previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), revision_action, target_entry.content, next_content,
    target_entry.document, null, 2);
  update public.log_entries set
    original_document = coalesce(original_document, document),
    document = next_document, content = next_content,
    entry_type = case when next_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    speaker_name = nullif(next_document#>>'{speaker,name}', ''),
    speaker_color = nullif(next_document#>>'{speaker,color}', ''),
    metadata = metadata || '{"edited": true}'::jsonb,
    has_image_content = next_has_image_content,
    updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  update public.logs set content_version = content_version + 1 where id = target_entry.log_id;
  return public.log_entry_dto(target_entry);
end;
$$;

create or replace function public.update_log_entry_content_v3(
  target_page_id uuid, target_entry_id uuid, next_content text, next_raw_html text,
  revision_action text default 'edit', expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id and e.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another member';
  end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content)
  values (target_entry.id, auth.uid(), revision_action, target_entry.content, next_content);
  update public.log_entries set content = next_content, raw_html = next_raw_html,
    metadata = metadata || '{"edited": true}'::jsonb, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  update public.logs set content_version = content_version + 1 where id = target_entry.log_id;
  return public.log_entry_dto(target_entry);
end;
$$;

create or replace function public.set_log_entry_deleted_v3(
  target_page_id uuid, target_entry_id uuid, should_delete boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.is_deleted = should_delete then return public.log_entry_dto(target_entry); end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content,
    previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), case when should_delete then 'delete' else 'restore' end,
    target_entry.content, target_entry.content, null, null, target_entry.document_version);
  update public.log_entries set is_deleted = should_delete,
    deleted_at = case when should_delete then now() else null end, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  update public.logs set content_version = content_version + 1,
    visible_entry_count = greatest(0, visible_entry_count + case when should_delete then -1 else 1 end)
  where id = target_entry.log_id;
  return public.log_entry_dto(target_entry);
end;
$$;

create or replace function public.create_log_entry_v3(
  target_page_id uuid, after_entry_id uuid, new_document jsonb, new_content text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log_id uuid;
declare previous_key bigint;
declare next_key bigint;
declare insert_key bigint;
declare insert_index integer;
declare created_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if new_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id for update;
  if target_log_id is null then raise exception 'log not found'; end if;
  select coalesce(max(order_index), -1) + 1 into insert_index
  from public.log_entries where log_id = target_log_id;
  if after_entry_id is null then
    select coalesce(max(sort_key), 0) into previous_key from public.log_entries where log_id = target_log_id;
    insert_key := previous_key + 1000000;
  else
    select sort_key into previous_key
    from public.log_entries where id = after_entry_id and log_id = target_log_id;
    if previous_key is null then raise exception 'previous entry not found'; end if;
    select sort_key into next_key from public.log_entries
      where log_id = target_log_id and sort_key > previous_key order by sort_key limit 1;
    if next_key is null then insert_key := previous_key + 1000000;
    elsif next_key - previous_key > 1 then insert_key := previous_key + ((next_key - previous_key) / 2);
    else
      perform set_config('app.bulk_log_replace', 'true', true);
      update public.log_entries set sort_key = -ranked.new_key
      from (select id, row_number() over(order by sort_key) * 1000000 as new_key
            from public.log_entries where log_id = target_log_id) ranked
      where public.log_entries.id = ranked.id;
      update public.log_entries set sort_key = -sort_key where log_id = target_log_id;
      perform set_config('app.bulk_log_replace', 'false', true);
      select sort_key into previous_key from public.log_entries where id = after_entry_id;
      select sort_key into next_key from public.log_entries
        where log_id = target_log_id and sort_key > previous_key order by sort_key limit 1;
      insert_key := case when next_key is null then previous_key + 1000000 else previous_key + ((next_key - previous_key) / 2) end;
    end if;
  end if;
  insert into public.log_entries(log_id, order_index, sort_key, entry_type, speaker_name,
    speaker_color, content, original_content, raw_html, metadata, is_added, updated_by,
    document_version, document, original_document, has_image_content)
  values (target_log_id, insert_index, insert_key,
    case when new_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    nullif(new_document#>>'{speaker,name}', ''), nullif(new_document#>>'{speaker,color}', ''),
    new_content, null, null, '{"added": true}'::jsonb, true, auth.uid(), 2,
    new_document, null, jsonb_path_exists(new_document, '$.blocks[*] ? (@.type == "image")'))
  returning * into created_entry;
  update public.logs set content_version = content_version + 1,
    visible_entry_count = visible_entry_count + 1 where id = target_log_id;
  return public.log_entry_dto(created_entry);
end;
$$;

create or replace function public.get_published_log(
  publication_token text,
  after_sort_key bigint default null,
  batch_size integer default 300
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
declare bounded_size integer := greatest(1, least(coalesce(batch_size, 300), 300));
begin
  select jsonb_build_object(
    'page', jsonb_build_object('id', p.id, 'title', p.title),
    'publishedAt', publication.published_at,
    'totalCount', l.visible_entry_count,
    'entries', coalesce((
      select jsonb_agg(public.log_entry_dto(e) order by e.sort_key)
      from (
        select entry.* from public.log_entries entry
        where entry.log_id = l.id and entry.is_deleted = false
          and (after_sort_key is null or entry.sort_key > after_sort_key)
        order by entry.sort_key limit bounded_size
      ) e
    ), '[]'::jsonb)
  ) into result
  from public.publications publication
  join public.pages p on p.id = publication.page_id
  join public.logs l on l.page_id = p.id
  where publication.token = publication_token and publication.is_active
    and p.page_type = 'log' and p.is_archived = false and p.deleted_at is null;
  return result;
end;
$$;

create or replace function public.purge_stale_log_change_events()
returns integer language plpgsql security definer set search_path = public as $$
declare purged_count integer;
begin
  delete from public.log_change_events where updated_at < now() - interval '7 days';
  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on public.log_change_events from anon;
grant select on public.log_change_events to authenticated;
revoke execute on function public.log_entry_dto(public.log_entries) from public, anon, authenticated;
revoke execute on function public.get_log_entries_page(uuid, bigint, integer) from public, anon;
revoke execute on function public.get_log_entry_dto(uuid, uuid) from public, anon;
revoke execute on function public.replace_log_entries_v3(uuid, uuid, text, text, bigint, bigint, text, jsonb, jsonb, bigint, text) from public, anon;
revoke execute on function public.update_log_entry_document_v3(uuid, uuid, jsonb, text, boolean, text, timestamptz) from public, anon;
revoke execute on function public.update_log_entry_content_v3(uuid, uuid, text, text, text, timestamptz) from public, anon;
revoke execute on function public.set_log_entry_deleted_v3(uuid, uuid, boolean) from public, anon;
revoke execute on function public.create_log_entry_v3(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.get_log_entries_page(uuid, bigint, integer) to authenticated;
grant execute on function public.get_log_entry_dto(uuid, uuid) to authenticated;
grant execute on function public.replace_log_entries_v3(uuid, uuid, text, text, bigint, bigint, text, jsonb, jsonb, bigint, text) to authenticated;
grant execute on function public.update_log_entry_document_v3(uuid, uuid, jsonb, text, boolean, text, timestamptz) to authenticated;
grant execute on function public.update_log_entry_content_v3(uuid, uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.set_log_entry_deleted_v3(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_log_entry_v3(uuid, uuid, jsonb, text) to authenticated;
revoke execute on function public.get_published_log(text, bigint, integer) from public;
grant execute on function public.get_published_log(text, bigint, integer) to anon, authenticated, service_role;
revoke execute on function public.purge_stale_log_change_events() from public, anon, authenticated;
grant execute on function public.purge_stale_log_change_events() to service_role;

-- Retire duplicate/raw legacy write entry points. Current server routes use the v3 RPCs;
-- the old definitions remain only for rollback inspection and existing data compatibility.
revoke execute on function public.replace_log_entries(uuid, text, text, jsonb, jsonb) from authenticated;
revoke execute on function public.replace_log_entries_v2(uuid, text, text, jsonb, jsonb) from authenticated;
revoke execute on function public.update_log_entry_content(uuid, uuid, text, text, text, timestamptz) from authenticated;
revoke execute on function public.update_log_entry_document_v2(uuid, uuid, jsonb, text, text, timestamptz) from authenticated;
revoke execute on function public.create_log_entry(uuid, uuid, text, text, text, text) from authenticated;
revoke execute on function public.create_log_entry_v2(uuid, uuid, jsonb, text) from authenticated;
revoke execute on function public.set_log_entry_deleted(uuid, uuid, boolean) from authenticated;
revoke execute on function public.set_log_entry_deleted_v2(uuid, uuid, boolean) from authenticated;
