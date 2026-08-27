-- Reduce authenticated page latency without changing resource permission semantics.

create index if not exists folder_items_child_folder_idx
on public.folder_items(child_resource_id, folder_id);

create index if not exists pages_owner_live_idx
on public.pages(original_owner_id, created_at)
where deleted_at is null;

create or replace function public.get_resource_permissions(target_resource_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, scope.path || fi.folder_id
    from scope
    join public.folder_items fi on fi.child_resource_id = scope.resource_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where not fi.folder_id = any(scope.path)
  ), actor as (
    select auth.uid() as id, public.is_account_approved(auth.uid()) as approved
  ), target as (
    select p.id, p.original_owner_id, p.deleted_at
    from public.pages p where p.id = target_resource_id
  ), grants as (
    select
      exists (
        select 1 from scope s
        join public.pages p on p.id = s.resource_id and p.deleted_at is null
        left join public.resource_shares rs on rs.resource_id = s.resource_id
          and rs.user_id = actor.id and rs.revoked_at is null
        where p.original_owner_id = actor.id or rs.id is not null
      ) as can_view,
      exists (
        select 1 from scope s
        join public.pages p on p.id = s.resource_id and p.deleted_at is null
        left join public.resource_shares rs on rs.resource_id = s.resource_id
          and rs.user_id = actor.id and rs.revoked_at is null and rs.can_invite
        where p.original_owner_id = actor.id or rs.id is not null
      ) as can_invite
    from actor
  )
  select jsonb_build_object(
    'canView', actor.approved and target.deleted_at is null and grants.can_view,
    'canEdit', actor.approved and target.deleted_at is null and grants.can_view,
    'canInvite', actor.approved and target.deleted_at is null and grants.can_invite,
    'canManage', actor.approved and target.deleted_at is null and target.original_owner_id = actor.id,
    'isOriginalOwner', actor.approved and target.original_owner_id = actor.id,
    'canSelfRemove', actor.approved and exists (
      select 1 from public.resource_shares rs
      where rs.resource_id = target_resource_id and rs.user_id = actor.id and rs.revoked_at is null
    )
  )
  from actor
  left join target on true
  cross join grants;
$$;

drop function if exists public.get_workspace_tree(uuid);

create or replace function public.get_workspace_tree(target_workspace_id uuid)
returns table(
  id uuid, workspace_id uuid, legacy_parent_id uuid, page_type text, title text, icon text,
  order_index integer, is_archived boolean, original_owner_id uuid, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, tree_parent_id uuid, tree_depth integer,
  tree_relation text, is_original_owner boolean, can_invite boolean, can_self_remove boolean
) language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select wi.resource_id,
      case
        when wi.parent_local_resource_id is null then null
        when exists (
          select 1 from public.workspace_items parent_item
          join public.pages local_parent on local_parent.id = parent_item.resource_id
            and local_parent.page_type = 'folder' and local_parent.deleted_at is null
          where parent_item.workspace_id = wi.workspace_id
            and parent_item.resource_id = wi.parent_local_resource_id
        ) then wi.parent_local_resource_id
        else null
      end as tree_parent_id,
      wi.order_index as tree_order, 0 as depth, array[wi.resource_id] as path,
      'workspace'::text as relation
    from public.workspace_items wi
    join public.workspaces w on w.id = wi.workspace_id
    join public.pages mounted on mounted.id = wi.resource_id and mounted.deleted_at is null
    where wi.workspace_id = target_workspace_id and w.owner_id = auth.uid()
    union all
    select fi.child_resource_id, fi.folder_id, fi.order_index, tree.depth + 1,
      tree.path || fi.child_resource_id, 'folder'::text
    from tree
    join public.pages current_folder on current_folder.id = tree.resource_id
      and current_folder.page_type = 'folder' and current_folder.deleted_at is null
    join public.folder_items fi on fi.folder_id = tree.resource_id
    join public.pages child on child.id = fi.child_resource_id and child.deleted_at is null
    where not fi.child_resource_id = any(tree.path)
  ), authorized as (
    select tree.*,
      exists (
        select 1
        from unnest(tree.path) as path_resource(path_resource_id)
        join public.pages grant_page on grant_page.id = path_resource.path_resource_id and grant_page.deleted_at is null
        left join public.resource_shares grant_share on grant_share.resource_id = path_resource.path_resource_id
          and grant_share.user_id = auth.uid() and grant_share.revoked_at is null
        where grant_page.original_owner_id = auth.uid() or grant_share.id is not null
      ) as can_view,
      exists (
        select 1
        from unnest(tree.path) as path_resource(path_resource_id)
        join public.pages grant_page on grant_page.id = path_resource.path_resource_id and grant_page.deleted_at is null
        left join public.resource_shares grant_share on grant_share.resource_id = path_resource.path_resource_id
          and grant_share.user_id = auth.uid() and grant_share.revoked_at is null and grant_share.can_invite
        where grant_page.original_owner_id = auth.uid() or grant_share.id is not null
      ) as can_invite
    from tree
  ), preferred as (
    select distinct on (authorized.resource_id) authorized.*
    from authorized
    where authorized.can_view
    order by authorized.resource_id, authorized.depth desc
  )
  select p.id, p.workspace_id, p.parent_id, p.page_type, p.title, p.icon,
    preferred.tree_order, p.is_archived, p.original_owner_id, p.deleted_at,
    p.created_at, p.updated_at, preferred.tree_parent_id, preferred.depth, preferred.relation,
    p.original_owner_id = auth.uid(), preferred.can_invite,
    direct_share.id is not null
  from preferred
  join public.pages p on p.id = preferred.resource_id
  left join public.resource_shares direct_share on direct_share.resource_id = p.id
    and direct_share.user_id = auth.uid() and direct_share.revoked_at is null
  where public.is_account_approved(auth.uid()) and p.deleted_at is null and not p.is_archived
  order by preferred.depth, preferred.tree_order, p.created_at;
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
  into result_entries
  from (
    select * from public.log_entries
    where log_id = target_log.id and is_deleted = false
    order by sort_key limit bounded_size
  ) e;

  select jsonb_build_object(
    'id', pub.id, 'page_id', pub.page_id, 'token', pub.token,
    'is_active', pub.is_active, 'published_at', pub.published_at, 'updated_at', pub.updated_at
  ) into publication
  from public.publications pub where pub.page_id = target_page_id;

  return jsonb_build_object(
    'page', jsonb_build_object(
      'id', target_page.id, 'workspace_id', target_page.workspace_id,
      'parent_id', target_page.parent_id, 'page_type', target_page.page_type,
      'title', target_page.title, 'icon', target_page.icon,
      'order_index', target_page.order_index, 'is_archived', target_page.is_archived,
      'original_owner_id', target_page.original_owner_id, 'deleted_at', target_page.deleted_at,
      'created_at', target_page.created_at, 'updated_at', target_page.updated_at,
      'is_original_owner', coalesce((permissions->>'isOriginalOwner')::boolean, false),
      'can_self_remove', coalesce((permissions->>'canSelfRemove')::boolean, false)
    ),
    'logId', target_log.id,
    'importReport', target_log.import_report,
    'totalCount', target_log.visible_entry_count,
    'entries', result_entries,
    'publication', publication,
    'batchSize', bounded_size
  );
end;
$$;

revoke all on function public.get_workspace_log_page(uuid, integer) from public;
grant execute on function public.get_workspace_log_page(uuid, integer) to authenticated;
grant execute on function public.get_workspace_tree(uuid) to authenticated;
grant execute on function public.get_resource_permissions(uuid) to authenticated;

create or replace function public.get_personal_session_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name,
      'account_status', p.account_status, 'is_site_admin', p.is_site_admin,
      'approved_at', p.approved_at, 'approved_by', p.approved_by,
      'created_at', p.created_at, 'updated_at', p.updated_at
    ),
    'workspace', jsonb_build_object(
      'id', w.id, 'name', w.name, 'owner_id', w.owner_id,
      'created_at', w.created_at, 'updated_at', w.updated_at
    )
  )
  from public.profiles p
  join public.workspaces w on w.owner_id = p.id
  where p.id = auth.uid() and p.account_status = 'approved'
  limit 1;
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
    'canEdit', coalesce((permissions->>'canEdit')::boolean, false),
    'canInvite', coalesce((permissions->>'canInvite')::boolean, false),
    'canManage', coalesce((permissions->>'canManage')::boolean, false),
    'isOriginalOwner', coalesce((permissions->>'isOriginalOwner')::boolean, false),
    'canSelfRemove', coalesce((permissions->>'canSelfRemove')::boolean, false)
  );
end;
$$;

revoke all on function public.get_personal_session_context() from public;
revoke all on function public.get_resource_api_context(uuid) from public;
grant execute on function public.get_personal_session_context() to authenticated;
grant execute on function public.get_resource_api_context(uuid) to authenticated;
