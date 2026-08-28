-- Remove duplicate hierarchy expansion and combine hot entry edit reads.

drop function if exists public.get_workspace_tree(uuid);

create or replace function public.get_workspace_tree(target_workspace_id uuid)
returns table(
  id uuid, workspace_id uuid, legacy_parent_id uuid, page_type text, title text, icon text,
  order_index integer, is_archived boolean, original_owner_id uuid, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, tree_parent_id uuid, tree_depth integer,
  tree_relation text, is_original_owner boolean, can_invite boolean, can_self_remove boolean
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
      and (p.original_owner_id = actor.id or direct_share.id is not null)
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
    select direct_mounts.*
    from direct_mounts
    where not exists (
      select 1 from folder_ancestors
      join direct_mounts ancestor_mount on ancestor_mount.resource_id = folder_ancestors.ancestor_id
      where folder_ancestors.resource_id = direct_mounts.resource_id
    )
  ), tree as (
    select root_mounts.resource_id,
      case when exists (
        select 1 from direct_mounts local_parent
        where local_parent.resource_id = root_mounts.parent_local_resource_id
      ) then root_mounts.parent_local_resource_id else null end as tree_parent_id,
      root_mounts.order_index as tree_order, 0 as depth,
      array[root_mounts.resource_id] as path, 'workspace'::text as relation
    from root_mounts
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
  )
  select p.id, p.workspace_id, p.parent_id, p.page_type, p.title, p.icon,
    tree.tree_order, p.is_archived, p.original_owner_id, p.deleted_at,
    p.created_at, p.updated_at, tree.tree_parent_id, tree.depth, tree.relation,
    p.original_owner_id = actor.id,
    exists (
      select 1
      from unnest(tree.path) as path_resource(resource_id)
      join public.pages grant_page on grant_page.id = path_resource.resource_id and grant_page.deleted_at is null
      left join public.resource_shares grant_share on grant_share.resource_id = path_resource.resource_id
        and grant_share.user_id = actor.id and grant_share.revoked_at is null and grant_share.can_invite
      where grant_page.original_owner_id = actor.id or grant_share.id is not null
    ),
    direct_share.id is not null
  from tree
  cross join actor
  join public.pages p on p.id = tree.resource_id
  left join public.resource_shares direct_share on direct_share.resource_id = p.id
    and direct_share.user_id = actor.id and direct_share.revoked_at is null
  order by tree.depth, tree.tree_order, p.created_at;
$$;

create or replace function public.get_log_entry_edit_source(target_page_id uuid, target_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then return null; end if;
  select entry.* into target_entry
  from public.log_entries entry
  join public.logs log on log.id = entry.log_id
  where log.page_id = target_page_id and entry.id = target_entry_id and not entry.is_deleted;
  if target_entry.id is null then return null; end if;
  return jsonb_build_object(
    'id', target_entry.id,
    'raw_html', target_entry.raw_html,
    'document_version', target_entry.document_version,
    'document', target_entry.document,
    'original_document', target_entry.original_document,
    'updated_at', target_entry.updated_at
  );
end;
$$;

revoke all on function public.get_workspace_tree(uuid) from public;
revoke all on function public.get_log_entry_edit_source(uuid, uuid) from public;
grant execute on function public.get_workspace_tree(uuid) to authenticated;
grant execute on function public.get_log_entry_edit_source(uuid, uuid) to authenticated;
