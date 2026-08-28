-- Four-level Resource roles. Ownership remains immutable on pages.original_owner_id;
-- resource_shares stores only viewer/editor/admin grants. The legacy can_invite
-- columns remain during rollout but are no longer an authorization source.

alter table public.resource_shares drop constraint if exists resource_shares_access_level_check;
alter table public.resource_shares add constraint resource_shares_access_level_check
  check (access_level in ('viewer', 'editor', 'admin'));

alter table public.pending_resource_shares
  add column if not exists access_level text not null default 'editor';
alter table public.pending_resource_shares
  drop constraint if exists pending_resource_shares_access_level_check;
alter table public.pending_resource_shares
  add constraint pending_resource_shares_access_level_check
  check (access_level in ('viewer', 'editor', 'admin'));

update public.resource_shares
set access_level = case when can_invite then 'admin' else 'editor' end;

update public.pending_resource_shares
set access_level = case when can_invite then 'admin' else 'editor' end;

create or replace function public.resource_role_rank(resource_role text)
returns integer language sql immutable set search_path = public as $$
  select case resource_role
    when 'viewer' then 1
    when 'editor' then 2
    when 'admin' then 3
    when 'owner' then 4
    else 0
  end;
$$;

create or replace function public.get_effective_resource_role(
  target_resource_id uuid,
  target_user_id uuid default auth.uid()
) returns text language sql stable security definer set search_path = public as $$
  with recursive scope(resource_id, depth, path) as (
    select target_resource_id, 0, array[target_resource_id]
    union all
    select fi.folder_id, scope.depth + 1, scope.path || fi.folder_id
    from scope
    join public.folder_items fi on fi.child_resource_id = scope.resource_id
    join public.pages ancestor on ancestor.id = fi.folder_id
      and ancestor.deleted_at is null and not ancestor.is_archived
    where not fi.folder_id = any(scope.path)
  ), candidates as (
    select case
      when scope.depth = 0 and page.original_owner_id = target_user_id then 'owner'
      when scope.depth > 0 and page.original_owner_id = target_user_id then 'admin'
      else null
    end as resource_role
    from scope
    join public.pages page on page.id = scope.resource_id
      and page.deleted_at is null and not page.is_archived
    union all
    select share.access_level
    from scope
    join public.resource_shares share on share.resource_id = scope.resource_id
      and share.user_id = target_user_id and share.revoked_at is null
  )
  select case
    when not public.is_account_approved(target_user_id) then null
    when not exists (
      select 1 from public.pages
      where id = target_resource_id and deleted_at is null and not is_archived
    ) then null
    else (
      select resource_role from candidates
      where resource_role is not null
      order by public.resource_role_rank(resource_role) desc
      limit 1
    )
  end;
$$;

create or replace function public.can_view_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.resource_role_rank(public.get_effective_resource_role(target_resource_id, target_user_id)) >= 1;
$$;

create or replace function public.can_edit_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.resource_role_rank(public.get_effective_resource_role(target_resource_id, target_user_id)) >= 2;
$$;

create or replace function public.can_manage_resource_shares(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.resource_role_rank(public.get_effective_resource_role(target_resource_id, target_user_id)) >= 3;
$$;

create or replace function public.can_manage_guest_link(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_resource_shares(target_resource_id, target_user_id)
    and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log');
$$;

create or replace function public.can_publish_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_resource_shares(target_resource_id, target_user_id)
    and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log');
$$;

create or replace function public.can_reimport_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_effective_resource_role(target_resource_id, target_user_id) = 'owner'
    and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log');
$$;

create or replace function public.can_restore_resource_original(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_reimport_resource(target_resource_id, target_user_id);
$$;

create or replace function public.can_delete_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_effective_resource_role(target_resource_id, target_user_id) = 'owner';
$$;

-- Deprecated compatibility helper. New authorization code uses the role helpers.
create or replace function public.can_invite_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_resource_shares(target_resource_id, target_user_id);
$$;

create or replace function public.get_resource_permissions(target_resource_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with role_value as (
    select public.get_effective_resource_role(target_resource_id, auth.uid()) as resource_role
  )
  select jsonb_build_object(
    'role', resource_role,
    'canView', public.resource_role_rank(resource_role) >= 1,
    'canEdit', public.resource_role_rank(resource_role) >= 2,
    'canManageShares', public.resource_role_rank(resource_role) >= 3,
    'canManageGuestLink', public.resource_role_rank(resource_role) >= 3
      and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log'),
    'canPublish', public.resource_role_rank(resource_role) >= 3
      and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log'),
    'canReimport', resource_role = 'owner'
      and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log'),
    'canRestoreOriginal', resource_role = 'owner'
      and exists (select 1 from public.pages where id = target_resource_id and page_type = 'log'),
    'canTrashResource', resource_role = 'owner',
    'canSelfRemove', resource_role <> 'owner'
      and public.has_direct_resource_share(target_resource_id, auth.uid()),
    -- Rollout compatibility keys. They are projections, not authority.
    'canInvite', public.resource_role_rank(resource_role) >= 3,
    'canManage', resource_role = 'owner',
    'isOriginalOwner', resource_role = 'owner'
  ) from role_value;
$$;

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
    select direct_mounts.* from direct_mounts
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

create or replace function public.get_resource_api_context(target_resource_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare permissions jsonb;
declare target_page public.pages;
begin
  permissions := public.get_resource_permissions(target_resource_id);
  if not coalesce((permissions->>'canView')::boolean, false) then return null; end if;
  select * into target_page from public.pages where id = target_resource_id and deleted_at is null;
  if target_page.id is null then return null; end if;
  return jsonb_build_object(
    'page', jsonb_build_object(
      'id', target_page.id, 'page_type', target_page.page_type,
      'original_owner_id', target_page.original_owner_id, 'deleted_at', target_page.deleted_at
    ),
    'permissions', permissions,
    'canEdit', coalesce((permissions->>'canEdit')::boolean, false),
    'canInvite', coalesce((permissions->>'canManageShares')::boolean, false),
    'canManage', coalesce((permissions->>'isOriginalOwner')::boolean, false),
    'isOriginalOwner', coalesce((permissions->>'isOriginalOwner')::boolean, false),
    'canSelfRemove', coalesce((permissions->>'canSelfRemove')::boolean, false)
  );
end;
$$;

create or replace function public.get_workspace_log_page(
  target_page_id uuid,
  batch_size integer default 100
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare permissions jsonb;
declare target_page public.pages;
declare target_log public.logs;
declare bounded_size integer := greatest(1, least(coalesce(batch_size, 100), 200));
declare result_entries jsonb;
declare publication jsonb;
begin
  permissions := public.get_resource_permissions(target_page_id);
  if not coalesce((permissions->>'canView')::boolean, false) then return null; end if;
  select * into target_page from public.pages
  where id = target_page_id and page_type = 'log' and deleted_at is null;
  if target_page.id is null then return null; end if;
  select * into target_log from public.logs where page_id = target_page_id;
  if target_log.id is null then return null; end if;

  select coalesce(jsonb_agg(public.log_entry_dto(e) order by e.sort_key), '[]'::jsonb)
  into result_entries from (
    select * from public.log_entries
    where log_id = target_log.id and is_deleted = false
    order by sort_key limit bounded_size
  ) e;

  select jsonb_build_object(
    'id', pub.id, 'page_id', pub.page_id, 'token', pub.token,
    'is_active', pub.is_active, 'published_at', pub.published_at, 'updated_at', pub.updated_at
  ) into publication from public.publications pub where pub.page_id = target_page_id;

  return jsonb_build_object(
    'page', jsonb_build_object(
      'id', target_page.id, 'workspace_id', target_page.workspace_id,
      'parent_id', target_page.parent_id, 'page_type', target_page.page_type,
      'title', target_page.title, 'icon', target_page.icon,
      'order_index', target_page.order_index, 'is_archived', target_page.is_archived,
      'original_owner_id', target_page.original_owner_id, 'deleted_at', target_page.deleted_at,
      'created_at', target_page.created_at, 'updated_at', target_page.updated_at,
      'resource_role', permissions->>'role',
      'is_original_owner', coalesce((permissions->>'isOriginalOwner')::boolean, false),
      'can_edit', coalesce((permissions->>'canEdit')::boolean, false),
      'can_manage_shares', coalesce((permissions->>'canManageShares')::boolean, false),
      'can_self_remove', coalesce((permissions->>'canSelfRemove')::boolean, false)
    ),
    'permissions', permissions,
    'logId', target_log.id,
    'importReport', target_log.import_report,
    'totalCount', target_log.visible_entry_count,
    'entries', result_entries,
    'publication', publication,
    'batchSize', bounded_size
  );
end;
$$;

revoke all on function public.resource_role_rank(text) from public, anon;
revoke all on function public.get_effective_resource_role(uuid, uuid) from public, anon;
revoke all on function public.can_manage_guest_link(uuid, uuid) from public, anon;
revoke all on function public.can_publish_resource(uuid, uuid) from public, anon;
revoke all on function public.can_reimport_resource(uuid, uuid) from public, anon;
revoke all on function public.can_restore_resource_original(uuid, uuid) from public, anon;
revoke all on function public.get_resource_permissions(uuid) from public, anon;
revoke all on function public.get_workspace_tree(uuid) from public, anon;
revoke all on function public.get_resource_api_context(uuid) from public, anon;
revoke all on function public.get_workspace_log_page(uuid, integer) from public, anon;

grant execute on function public.resource_role_rank(text) to authenticated, service_role;
grant execute on function public.get_effective_resource_role(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_view_resource(uuid, uuid) to authenticated;
grant execute on function public.can_edit_resource(uuid, uuid) to authenticated;
grant execute on function public.can_manage_resource_shares(uuid, uuid) to authenticated;
grant execute on function public.can_manage_guest_link(uuid, uuid) to authenticated;
grant execute on function public.can_publish_resource(uuid, uuid) to authenticated;
grant execute on function public.can_reimport_resource(uuid, uuid) to authenticated;
grant execute on function public.can_restore_resource_original(uuid, uuid) to authenticated;
grant execute on function public.can_delete_resource(uuid, uuid) to authenticated;
grant execute on function public.can_invite_resource(uuid, uuid) to authenticated;
grant execute on function public.get_resource_permissions(uuid) to authenticated;
grant execute on function public.get_workspace_tree(uuid) to authenticated;
grant execute on function public.get_resource_api_context(uuid) to authenticated;
grant execute on function public.get_workspace_log_page(uuid, integer) to authenticated;
