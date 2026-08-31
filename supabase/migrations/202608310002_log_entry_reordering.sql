-- Reorder an editor's loaded timeline segment atomically while retaining each
-- imported document's immutable source.sourceOrder.
create or replace function public.reorder_log_entries_v1(
  target_page_id uuid,
  ordered_entry_ids uuid[],
  expected_entry_ids uuid[],
  expected_sort_keys bigint[]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target_log public.logs;
declare slot_keys bigint[];
declare matched_count integer;
declare assignment_count integer;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if cardinality(ordered_entry_ids) < 2 or cardinality(ordered_entry_ids) > 500
    or cardinality(expected_entry_ids) <> cardinality(ordered_entry_ids)
    or cardinality(expected_sort_keys) <> cardinality(ordered_entry_ids)
  then raise exception 'invalid reorder range'; end if;
  if (select count(distinct value) from unnest(ordered_entry_ids) value) <> cardinality(ordered_entry_ids)
    or (select count(distinct value) from unnest(expected_entry_ids) value) <> cardinality(expected_entry_ids)
  then raise exception 'duplicate entry id'; end if;

  select * into target_log from public.logs where page_id = target_page_id for update;
  if target_log.id is null then raise exception 'log not found'; end if;

  select count(*) into matched_count
  from unnest(expected_entry_ids, expected_sort_keys) expected(entry_id, sort_key)
  join public.log_entries entry on entry.id = expected.entry_id
    and entry.log_id = target_log.id and entry.is_deleted = false
    and entry.sort_key = expected.sort_key;
  if matched_count <> cardinality(expected_entry_ids) then
    raise exception using errcode = '40001', message = 'timeline changed during reorder';
  end if;
  if exists (select 1 from unnest(ordered_entry_ids) value where not (value = any(expected_entry_ids)))
  then raise exception 'reorder target mismatch'; end if;

  select array_agg(value order by value) into slot_keys from unnest(expected_sort_keys) value;
  perform set_config('app.bulk_log_replace', 'true', true);
  update public.log_entries entry set sort_key = -entry.sort_key - 1
  where entry.log_id = target_log.id and entry.id = any(expected_entry_ids);
  update public.log_entries entry set sort_key = assignment.sort_key, updated_by = auth.uid()
  from (
    select entry_id, slot_keys[ordinality] as sort_key
    from unnest(ordered_entry_ids) with ordinality ordered(entry_id, ordinality)
  ) assignment
  where entry.id = assignment.entry_id and entry.log_id = target_log.id;
  get diagnostics assignment_count = row_count;
  perform set_config('app.bulk_log_replace', 'false', true);
  if assignment_count <> cardinality(ordered_entry_ids) then raise exception 'one or more entries were not reordered'; end if;

  update public.logs set content_version = content_version + 1 where id = target_log.id;
  insert into public.log_change_events(log_id, entry_id, event_type)
  values (target_log.id, null, 'log_replaced');
  return jsonb_build_object(
    'contentVersion', target_log.content_version + 1,
    'entries', (select jsonb_agg(jsonb_build_object('id', entry_id, 'sortKey', slot_keys[ordinality]) order by ordinality)
      from unnest(ordered_entry_ids) with ordinality ordered(entry_id, ordinality))
  );
end;
$$;

revoke all on function public.reorder_log_entries_v1(uuid, uuid[], uuid[], bigint[]) from public, anon;
grant execute on function public.reorder_log_entries_v1(uuid, uuid[], uuid[], bigint[]) to authenticated;
