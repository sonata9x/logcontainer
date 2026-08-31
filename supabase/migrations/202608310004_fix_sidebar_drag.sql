-- Keep ordinary sidebar nesting personal while preserving shared Folder moves.

create or replace function public.move_resources_bulk(
  target_resource_ids uuid[],
  target_folder_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor_id uuid := auth.uid();
  actor_workspace_id uuid;
  normalized_ids uuid[];
  resource_id uuid;
  source_folder_id uuid;
  personal_next_order integer;
  shared_next_order integer;
  moved_count integer := 0;
begin
  if not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if coalesce(array_length(target_resource_ids, 1), 0) > 100 then raise exception 'too many resources'; end if;

  select array_agg(resource_id order by first_position)
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

  if target_folder_id is not null then
    if not public.can_view_resource(target_folder_id, actor_id)
      or not exists (
        select 1 from public.pages
        where id = target_folder_id and page_type = 'folder' and deleted_at is null and not is_archived
      )
    then raise exception 'folder permission denied'; end if;

    select coalesce(max(order_index) + 1, 0) into personal_next_order
    from public.workspace_items
    where workspace_id = actor_workspace_id and parent_local_resource_id = target_folder_id;
    select coalesce(max(order_index) + 1, 0) into shared_next_order
    from public.folder_items where folder_id = target_folder_id;

    foreach resource_id in array normalized_ids loop
      source_folder_id := null;
      select folder_id into source_folder_id
      from public.folder_items where child_resource_id = resource_id;

      if source_folder_id is null then
        perform public.move_workspace_item(resource_id, target_folder_id, personal_next_order);
        personal_next_order := personal_next_order + 1;
      else
        perform public.insert_folder_item(target_folder_id, resource_id, shared_next_order);
        shared_next_order := shared_next_order + 1;
      end if;
      moved_count := moved_count + 1;
    end loop;
  else
    select coalesce(max(order_index) + 1, 0) into personal_next_order
    from public.workspace_items
    where workspace_id = actor_workspace_id and parent_local_resource_id is null;

    foreach resource_id in array normalized_ids loop
      source_folder_id := null;
      select folder_id into source_folder_id
      from public.folder_items where child_resource_id = resource_id;

      if source_folder_id is not null then
        perform public.remove_folder_item(source_folder_id, resource_id);
      end if;
      if public.can_view_resource(resource_id, actor_id) then
        perform public.move_workspace_item(resource_id, null, personal_next_order);
        personal_next_order := personal_next_order + 1;
      end if;
      moved_count := moved_count + 1;
    end loop;
  end if;

  return jsonb_build_object('movedCount', moved_count, 'targetFolderId', target_folder_id);
end;
$$;

revoke all on function public.move_resources_bulk(uuid[], uuid) from public, anon;
grant execute on function public.move_resources_bulk(uuid[], uuid) to authenticated;
