-- Owner-only full restore to the latest import's normalized canonical baseline.
-- The application archives the pre-restore generation in private Storage first.

create table if not exists public.log_restore_events (
  id uuid primary key,
  log_id uuid not null references public.logs(id) on delete cascade,
  restored_by uuid not null references auth.users(id) on delete restrict,
  generation_storage_path text not null,
  restored_entry_count integer not null default 0,
  removed_manual_entry_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists log_restore_events_log_created_idx
on public.log_restore_events(log_id, created_at desc);

alter table public.log_restore_events enable row level security;
revoke all on table public.log_restore_events from public, anon;
grant select on table public.log_restore_events to authenticated;
grant all on table public.log_restore_events to service_role;

create policy "owners read log restore audit" on public.log_restore_events
for select to authenticated using (exists (
  select 1 from public.logs log
  where log.id = log_restore_events.log_id
    and public.can_restore_resource_original(log.page_id, auth.uid())
));

create or replace function public.restore_log_original(
  target_page_id uuid,
  restore_event_id uuid,
  generation_storage_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log public.logs;
declare restored_count integer;
declare removed_count integer;
begin
  if not public.can_restore_resource_original(target_page_id, auth.uid())
  then raise exception 'permission denied'; end if;
  if nullif(trim(generation_storage_path), '') is null then raise exception 'generation archive is required'; end if;
  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;
  if not exists (select 1 from public.log_imports where log_id = target_log.id)
  then raise exception 'import baseline not found'; end if;

  perform set_config('app.bulk_log_replace', 'true', true);
  delete from public.log_entries where log_id = target_log.id and is_added = true;
  get diagnostics removed_count = row_count;

  update public.log_entries entry set
    document = coalesce(entry.original_document, entry.document),
    original_document = null,
    content = coalesce(entry.original_content, entry.content),
    raw_html = case when entry.document_version = 2 then null else entry.raw_html end,
    entry_type = case
      when coalesce(entry.original_document, entry.document)->>'kind' = 'dialogue' then 'dialogue'
      when entry.document_version = 2 then 'system'
      else entry.entry_type end,
    speaker_name = case when entry.document_version = 2
      then nullif(coalesce(entry.original_document, entry.document)#>>'{speaker,name}', '')
      else entry.speaker_name end,
    speaker_color = case when entry.document_version = 2
      then nullif(coalesce(entry.original_document, entry.document)#>>'{speaker,color}', '')
      else entry.speaker_color end,
    metadata = entry.metadata - 'edited' - 'added',
    is_deleted = false, deleted_at = null, updated_by = auth.uid()
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

revoke all on function public.restore_log_original(uuid, uuid, text) from public, anon;
grant execute on function public.restore_log_original(uuid, uuid, text) to authenticated;
