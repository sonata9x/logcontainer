-- Reorder one contiguous sidebar sibling range without changing personal/shared hierarchy semantics.

create or replace function public.reorder_resources_v1(
  target_relation text,
  target_parent_id uuid,
  ordered_resource_ids uuid[],
  expected_resource_ids uuid[],
  expected_order_indices integer[]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor_id uuid := auth.uid();
  actor_workspace_id uuid;
  slot_indices integer[];
  matched_count integer;
  assignment_count integer;
begin
  if not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if target_relation is null or target_relation not in ('workspace', 'folder')
    or coalesce(cardinality(ordered_resource_ids), 0) < 2
    or cardinality(ordered_resource_ids) > 500
    or coalesce(cardinality(expected_resource_ids), 0) <> cardinality(ordered_resource_ids)
    or coalesce(cardinality(expected_order_indices), 0) <> cardinality(ordered_resource_ids)
  then raise exception 'invalid reorder range'; end if;
  if (select count(distinct value) from unnest(ordered_resource_ids) value) <> cardinality(ordered_resource_ids)
    or (select count(distinct value) from unnest(expected_resource_ids) value) <> cardinality(expected_resource_ids)
    or exists (select 1 from unnest(ordered_resource_ids) value where not (value = any(expected_resource_ids)))
  then raise exception 'reorder target mismatch'; end if;

  select array_agg(value order by value) into slot_indices from unnest(expected_order_indices) value;

  if target_relation = 'workspace' then
    actor_workspace_id := public.personal_workspace_id(actor_id);
    if actor_workspace_id is null then raise exception 'personal workspace not found'; end if;
    if target_parent_id is not null and (
      not public.can_view_resource(target_parent_id, actor_id)
      or not exists (
        select 1 from public.pages
        where id = target_parent_id and page_type = 'folder' and deleted_at is null and not is_archived
      )
    ) then raise exception 'invalid local parent'; end if;

    select count(*) into matched_count
    from unnest(expected_resource_ids, expected_order_indices) expected(resource_id, order_index)
    join public.workspace_items item on item.resource_id = expected.resource_id
      and item.workspace_id = actor_workspace_id
      and item.parent_local_resource_id is not distinct from target_parent_id
      and item.order_index = expected.order_index;
    if matched_count <> cardinality(expected_resource_ids) then
      raise exception using errcode = '40001', message = 'workspace list changed during reorder';
    end if;

    update public.workspace_items item set
      order_index = assignment.order_index,
      updated_at = now()
    from (
      select resource_id, slot_indices[ordinality] as order_index
      from unnest(ordered_resource_ids) with ordinality ordered(resource_id, ordinality)
    ) assignment
    where item.workspace_id = actor_workspace_id and item.resource_id = assignment.resource_id;
    get diagnostics assignment_count = row_count;
  elsif target_relation = 'folder' then
    if target_parent_id is null
      or not public.can_edit_resource(target_parent_id, actor_id)
      or not exists (
        select 1 from public.pages
        where id = target_parent_id and page_type = 'folder' and deleted_at is null and not is_archived
      )
    then raise exception 'folder permission denied'; end if;

    select count(*) into matched_count
    from unnest(expected_resource_ids, expected_order_indices) expected(resource_id, order_index)
    join public.folder_items item on item.child_resource_id = expected.resource_id
      and item.folder_id = target_parent_id and item.order_index = expected.order_index;
    if matched_count <> cardinality(expected_resource_ids) then
      raise exception using errcode = '40001', message = 'shared folder changed during reorder';
    end if;

    update public.folder_items item set
      order_index = assignment.order_index,
      updated_at = now()
    from (
      select resource_id, slot_indices[ordinality] as order_index
      from unnest(ordered_resource_ids) with ordinality ordered(resource_id, ordinality)
    ) assignment
    where item.folder_id = target_parent_id and item.child_resource_id = assignment.resource_id;
    get diagnostics assignment_count = row_count;
    perform public.touch_resource_audience(target_parent_id);
  end if;

  if assignment_count <> cardinality(ordered_resource_ids) then raise exception 'one or more resources were not reordered'; end if;
  return jsonb_build_object(
    'relation', target_relation,
    'parentId', target_parent_id,
    'entries', (
      select jsonb_agg(jsonb_build_object('id', resource_id, 'orderIndex', slot_indices[ordinality]) order by ordinality)
      from unnest(ordered_resource_ids) with ordinality ordered(resource_id, ordinality)
    )
  );
end;
$$;

revoke all on function public.reorder_resources_v1(text, uuid, uuid[], uuid[], integer[]) from public, anon;
grant execute on function public.reorder_resources_v1(text, uuid, uuid[], uuid[], integer[]) to authenticated;
