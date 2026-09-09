-- Explicitly separate personal workspace placement from shared Folder hierarchy moves.

alter table public.workspace_items
  add column if not exists location_override boolean not null default false;

drop function if exists public.get_workspace_tree(uuid);

create or replace function public.get_workspace_tree(target_workspace_id uuid)
returns table(
  id uuid, workspace_id uuid, legacy_parent_id uuid, page_type text, title text, icon text,
  order_index integer, is_archived boolean, original_owner_id uuid, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, tree_parent_id uuid, tree_depth integer,
  tree_relation text, resource_role text, is_original_owner boolean, can_edit boolean,
  can_manage_shares boolean, can_invite boolean, can_self_remove boolean
) language sql stable security definer set search_path = public as $$
  with recursive actor as (
    select auth.uid() as id, public.is_account_approved(auth.uid()) as approved
  ), direct_mounts as (
    select wi.*, p.original_owner_id
    from public.workspace_items wi
    join public.workspaces w on w.id = wi.workspace_id
    join public.pages p on p.id = wi.resource_id and p.deleted_at is null and not p.is_archived
    cross join actor
    left join public.resource_shares direct_share on direct_share.resource_id = wi.resource_id
      and direct_share.user_id = actor.id and direct_share.revoked_at is null
    where wi.workspace_id = target_workspace_id and w.owner_id = actor.id and actor.approved
      and (p.original_owner_id = actor.id or direct_share.id is not null
        or (wi.location_override and public.can_view_resource(p.id, actor.id)))
  ), folder_ancestors(resource_id, ancestor_id, path) as (
    select direct_mounts.resource_id, fi.folder_id, array[direct_mounts.resource_id, fi.folder_id]
    from direct_mounts
    join public.folder_items fi on fi.child_resource_id = direct_mounts.resource_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    union all
    select folder_ancestors.resource_id, fi.folder_id, folder_ancestors.path || fi.folder_id
    from folder_ancestors
    join public.folder_items fi on fi.child_resource_id = folder_ancestors.ancestor_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where not fi.folder_id = any(folder_ancestors.path)
  ), root_mounts as (
    select direct_mounts.* from direct_mounts
    where direct_mounts.location_override or not exists (
      select 1 from folder_ancestors
      join direct_mounts ancestor_mount on ancestor_mount.resource_id = folder_ancestors.ancestor_id
      where folder_ancestors.resource_id = direct_mounts.resource_id
    )
  ), tree as (
    select root_mounts.resource_id,
      case when root_mounts.parent_local_resource_id is not null
        and public.can_view_resource(root_mounts.parent_local_resource_id, actor.id)
      then root_mounts.parent_local_resource_id else null end as tree_parent_id,
      root_mounts.order_index as tree_order, 0 as depth,
      array[root_mounts.resource_id] as path, 'workspace'::text as relation
    from root_mounts cross join actor
    union all
    select fi.child_resource_id, fi.folder_id, fi.order_index, tree.depth + 1,
      tree.path || fi.child_resource_id, 'folder'::text
    from tree
    join public.pages current_folder on current_folder.id = tree.resource_id
      and current_folder.page_type = 'folder' and current_folder.deleted_at is null
    join public.folder_items fi on fi.folder_id = tree.resource_id
    join public.pages child on child.id = fi.child_resource_id
      and child.deleted_at is null and not child.is_archived
    where not fi.child_resource_id = any(tree.path)
      and not exists (
        select 1 from direct_mounts local_override
        where local_override.resource_id = fi.child_resource_id
          and local_override.location_override
      )
  ), resolved as (
    select p.id, p.workspace_id, p.parent_id, p.page_type, p.title, p.icon,
      p.is_archived, p.original_owner_id, p.deleted_at, p.created_at, p.updated_at,
      tree.tree_parent_id, tree.tree_order, tree.depth, tree.relation,
      public.get_effective_resource_role(p.id, actor.id) as effective_role,
      direct_share.id is not null as has_direct_share
    from tree cross join actor
    join public.pages p on p.id = tree.resource_id
    left join public.resource_shares direct_share on direct_share.resource_id = p.id
      and direct_share.user_id = actor.id and direct_share.revoked_at is null
  )
  select resolved.id, resolved.workspace_id, resolved.parent_id, resolved.page_type,
    resolved.title, resolved.icon, resolved.tree_order, resolved.is_archived,
    resolved.original_owner_id, resolved.deleted_at, resolved.created_at, resolved.updated_at,
    resolved.tree_parent_id, resolved.depth, resolved.relation, resolved.effective_role,
    resolved.effective_role = 'owner', public.resource_role_rank(resolved.effective_role) >= 2,
    public.resource_role_rank(resolved.effective_role) >= 3,
    public.resource_role_rank(resolved.effective_role) >= 3,
    resolved.has_direct_share
  from resolved
  where resolved.effective_role is not null
  order by resolved.depth, resolved.tree_order, resolved.created_at;
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
  resource_id uuid;
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
  if exists (select 1 from unnest(normalized_ids) selected(id) where not public.can_view_resource(selected.id, actor_id))
  then raise exception 'resource permission denied'; end if;
  select bool_and(page.original_owner_id = actor_id)
  into all_owned
  from public.pages page
  where page.id = any(normalized_ids);

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
      select fi.folder_id, target_scope.path || fi.folder_id
      from target_scope
      join public.folder_items fi on fi.child_resource_id = target_scope.resource_id
      where not fi.folder_id = any(target_scope.path)
    )
    select exists (
      select 1 from target_scope
      join public.resource_shares share on share.resource_id = target_scope.resource_id
      where share.revoked_at is null
    ) into target_shared;
  end if;

  with recursive source_scope(child_resource_id, folder_id, path) as (
    select shared_item.child_resource_id, shared_item.folder_id,
      array[shared_item.child_resource_id, shared_item.folder_id]
    from public.folder_items shared_item
    where shared_item.child_resource_id = any(normalized_ids)
      and not exists (
        select 1 from public.workspace_items local_item
        where local_item.workspace_id = actor_workspace_id
          and local_item.resource_id = shared_item.child_resource_id
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
  -- With no shared Folder in play, an owner's ordinary move updates the real
  -- hierarchy. A collaborator's direct-share placement stays personal.
  effective_scope := coalesce(move_scope, case when all_owned then 'shared' else 'personal' end);

  if effective_scope = 'personal' then
    select coalesce(max(order_index) + 1, 0) into next_order
    from public.workspace_items
    where workspace_id = actor_workspace_id
      and parent_local_resource_id is not distinct from target_folder_id;

    foreach resource_id in array normalized_ids loop
      select folder_id into source_folder_id
      from public.folder_items where child_resource_id = resource_id;
      perform public.move_workspace_item(resource_id, target_folder_id, next_order);
      update public.workspace_items item
      set location_override = (source_folder_id is not null or target_shared), updated_at = now()
      where item.workspace_id = actor_workspace_id and item.resource_id = resource_id;
      next_order := next_order + 1;
      moved_count := moved_count + 1;
    end loop;
  else
    if target_folder_id is not null then
      select coalesce(max(order_index) + 1, 0) into next_order
      from public.folder_items where folder_id = target_folder_id;
      foreach resource_id in array normalized_ids loop
        perform public.insert_folder_item(target_folder_id, resource_id, next_order);
        update public.workspace_items item
        set location_override = false, updated_at = now()
        where item.workspace_id = actor_workspace_id and item.resource_id = resource_id;
        next_order := next_order + 1;
        moved_count := moved_count + 1;
      end loop;
    else
      foreach resource_id in array normalized_ids loop
        select folder_id into source_folder_id
        from public.folder_items where child_resource_id = resource_id;
        if source_folder_id is not null then
          perform public.remove_folder_item(source_folder_id, resource_id);
        end if;
        if public.can_view_resource(resource_id, actor_id) then
          perform public.move_workspace_item(resource_id, null, moved_count);
          update public.workspace_items item
          set location_override = false, updated_at = now()
          where item.workspace_id = actor_workspace_id and item.resource_id = resource_id;
        end if;
        moved_count := moved_count + 1;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'requiresScope', false,
    'scope', effective_scope,
    'movedCount', moved_count,
    'targetFolderId', target_folder_id
  );
end;
$$;

revoke all on function public.move_resources_scoped_v1(uuid[], uuid, text) from public, anon;
grant execute on function public.move_resources_scoped_v1(uuid[], uuid, text) to authenticated;
