-- Repair ambiguous movement SQL and make sibling reordering tolerant of stale order snapshots.

with ranked as (
  select id, (row_number() over (
    partition by workspace_id, parent_local_resource_id
    order by order_index, updated_at, created_at, id
  ) - 1)::integer as next_order
  from public.workspace_items
)
update public.workspace_items item
set order_index = ranked.next_order
from ranked
where item.id = ranked.id and item.order_index <> ranked.next_order;

with ranked as (
  select id, (row_number() over (
    partition by folder_id
    order by order_index, updated_at, created_at, id
  ) - 1)::integer as next_order
  from public.folder_items
)
update public.folder_items item
set order_index = ranked.next_order
from ranked
where item.id = ranked.id and item.order_index <> ranked.next_order;

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
  if (select count(distinct item_id) from unnest(ordered_resource_ids) as items(item_id)) <> cardinality(ordered_resource_ids)
    or (select count(distinct item_id) from unnest(expected_resource_ids) as items(item_id)) <> cardinality(expected_resource_ids)
    or exists (
      select 1 from unnest(ordered_resource_ids) as items(item_id)
      where not item_id = any(expected_resource_ids)
    )
  then raise exception 'reorder target mismatch'; end if;

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

    select array_agg(item.order_index order by item.order_index), count(*)
    into slot_indices, matched_count
    from unnest(expected_resource_ids) expected(resource_id)
    join public.workspace_items item on item.resource_id = expected.resource_id
      and item.workspace_id = actor_workspace_id
      and item.parent_local_resource_id is not distinct from target_parent_id;
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
    where item.workspace_id = actor_workspace_id and item.resource_id = assignment.resource_id
      and item.parent_local_resource_id is not distinct from target_parent_id;
    get diagnostics assignment_count = row_count;
  else
    if target_parent_id is null
      or not public.can_edit_resource(target_parent_id, actor_id)
      or not exists (
        select 1 from public.pages
        where id = target_parent_id and page_type = 'folder' and deleted_at is null and not is_archived
      )
    then raise exception 'folder permission denied'; end if;

    select array_agg(item.order_index order by item.order_index), count(*)
    into slot_indices, matched_count
    from unnest(expected_resource_ids) expected(resource_id)
    join public.folder_items item on item.child_resource_id = expected.resource_id
      and item.folder_id = target_parent_id;
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

  if assignment_count <> cardinality(ordered_resource_ids) then
    raise exception 'one or more resources were not reordered';
  end if;
  return jsonb_build_object(
    'relation', target_relation,
    'parentId', target_parent_id,
    'entries', (
      select jsonb_agg(
        jsonb_build_object('id', resource_id, 'orderIndex', slot_indices[ordinality])
        order by ordinality
      )
      from unnest(ordered_resource_ids) with ordinality ordered(resource_id, ordinality)
    )
  );
end;
$$;

create or replace function public.move_resources_scoped_v1(
  target_resource_ids uuid[],
  target_folder_id uuid default null,
  move_scope text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor_id uuid := auth.uid();
  actor_workspace_id uuid;
  normalized_ids uuid[];
  moving_resource_id uuid;
  source_folder_id uuid;
  source_shared boolean;
  target_shared boolean := false;
  all_owned boolean := false;
  effective_scope text;
  next_order integer;
  moved_count integer := 0;
begin
  if not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if coalesce(array_length(target_resource_ids, 1), 0) > 100 then raise exception 'too many resources'; end if;
  if move_scope is not null and move_scope not in ('personal', 'shared') then raise exception 'invalid move scope'; end if;

  select array_agg(selected.resource_id order by selected.first_position)
  into normalized_ids
  from (
    select item.resource_id, min(item.position) as first_position
    from unnest(coalesce(target_resource_ids, '{}'::uuid[])) with ordinality as item(resource_id, position)
    where item.resource_id is not null
    group by item.resource_id
  ) selected;
  if coalesce(array_length(normalized_ids, 1), 0) = 0 then raise exception 'resources are required'; end if;

  actor_workspace_id := public.personal_workspace_id(actor_id);
  if actor_workspace_id is null then raise exception 'personal workspace not found'; end if;
  if exists (
    select 1 from unnest(normalized_ids) selected(id)
    where not public.can_view_resource(selected.id, actor_id)
  ) then raise exception 'resource permission denied'; end if;
  select bool_and(page.original_owner_id = actor_id)
  into all_owned from public.pages page where page.id = any(normalized_ids);

  if target_folder_id is not null then
    if not public.can_view_resource(target_folder_id, actor_id)
      or not exists (
        select 1 from public.pages
        where id = target_folder_id and page_type = 'folder' and deleted_at is null and not is_archived
      )
    then raise exception 'folder permission denied'; end if;
    with recursive target_scope(resource_id, path) as (
      select target_folder_id, array[target_folder_id]
      union all
      select folder_item.folder_id, target_scope.path || folder_item.folder_id
      from target_scope
      join public.folder_items folder_item on folder_item.child_resource_id = target_scope.resource_id
      where not folder_item.folder_id = any(target_scope.path)
    )
    select exists (
      select 1 from target_scope
      join public.resource_shares share on share.resource_id = target_scope.resource_id
      where share.revoked_at is null
    ) into target_shared;
  end if;

  with recursive source_scope(child_resource_id, folder_id, path) as (
    select folder_item.child_resource_id, folder_item.folder_id,
      array[folder_item.child_resource_id, folder_item.folder_id]
    from public.folder_items folder_item
    where folder_item.child_resource_id = any(normalized_ids)
      and not exists (
        select 1 from public.workspace_items local_item
        where local_item.workspace_id = actor_workspace_id
          and local_item.resource_id = folder_item.child_resource_id
          and local_item.location_override
      )
    union all
    select source_scope.child_resource_id, parent_item.folder_id,
      source_scope.path || parent_item.folder_id
    from source_scope
    join public.folder_items parent_item on parent_item.child_resource_id = source_scope.folder_id
    where not parent_item.folder_id = any(source_scope.path)
  )
  select exists (
    select 1 from source_scope
    join public.resource_shares share on share.resource_id = source_scope.folder_id
    where share.revoked_at is null
  ) into source_shared;

  if move_scope is null and (source_shared or target_shared) then
    return jsonb_build_object(
      'requiresScope', true,
      'sourceShared', source_shared,
      'targetShared', target_shared,
      'targetFolderId', target_folder_id
    );
  end if;
  effective_scope := coalesce(move_scope, case when all_owned then 'shared' else 'personal' end);

  if effective_scope = 'personal' then
    select coalesce(max(order_index) + 1, 0) into next_order
    from public.workspace_items
    where workspace_id = actor_workspace_id
      and parent_local_resource_id is not distinct from target_folder_id;
    foreach moving_resource_id in array normalized_ids loop
      source_folder_id := null;
      select folder_id into source_folder_id
      from public.folder_items where child_resource_id = moving_resource_id;
      perform public.move_workspace_item(moving_resource_id, target_folder_id, next_order);
      update public.workspace_items item
      set location_override = (source_folder_id is not null or target_shared), updated_at = now()
      where item.workspace_id = actor_workspace_id and item.resource_id = moving_resource_id;
      next_order := next_order + 1;
      moved_count := moved_count + 1;
    end loop;
  elsif target_folder_id is not null then
    select coalesce(max(order_index) + 1, 0) into next_order
    from public.folder_items where folder_id = target_folder_id;
    foreach moving_resource_id in array normalized_ids loop
      perform public.insert_folder_item(target_folder_id, moving_resource_id, next_order);
      update public.workspace_items item
      set location_override = false, updated_at = now()
      where item.workspace_id = actor_workspace_id and item.resource_id = moving_resource_id;
      next_order := next_order + 1;
      moved_count := moved_count + 1;
    end loop;
  else
    select coalesce(max(order_index) + 1, 0) into next_order
    from public.workspace_items
    where workspace_id = actor_workspace_id and parent_local_resource_id is null;
    foreach moving_resource_id in array normalized_ids loop
      source_folder_id := null;
      select folder_id into source_folder_id
      from public.folder_items where child_resource_id = moving_resource_id;
      if source_folder_id is not null then
        perform public.remove_folder_item(source_folder_id, moving_resource_id);
      end if;
      if public.can_view_resource(moving_resource_id, actor_id) then
        perform public.move_workspace_item(moving_resource_id, null, next_order);
        update public.workspace_items item
        set location_override = false, updated_at = now()
        where item.workspace_id = actor_workspace_id and item.resource_id = moving_resource_id;
        next_order := next_order + 1;
      end if;
      moved_count := moved_count + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'requiresScope', false,
    'scope', effective_scope,
    'movedCount', moved_count,
    'targetFolderId', target_folder_id
  );
end;
$$;

revoke all on function public.reorder_resources_v1(text, uuid, uuid[], uuid[], integer[]) from public, anon;
grant execute on function public.reorder_resources_v1(text, uuid, uuid[], uuid[], integer[]) to authenticated;
revoke all on function public.move_resources_scoped_v1(uuid[], uuid, text) from public, anon;
grant execute on function public.move_resources_scoped_v1(uuid[], uuid, text) to authenticated;
