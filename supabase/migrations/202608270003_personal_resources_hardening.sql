-- Hardening for databases that applied the original WIP .002 migration before it was finalized.
-- New installations already receive these definitions from schema.sql/.002; every statement
-- here is additive or idempotent.

alter table public.resource_shares add column if not exists updated_at timestamptz not null default now();

alter table public.pages drop constraint if exists pages_parent_id_fkey;
alter table public.pages add constraint pages_parent_id_fkey
  foreign key (parent_id) references public.pages(id) on delete set null;

update public.pages
set deleted_at = coalesce(deleted_at, updated_at, now()),
    purge_after = coalesce(purge_after, coalesce(deleted_at, updated_at, now()) + interval '30 days'),
    deleted_by = coalesce(deleted_by, original_owner_id)
where is_archived and deleted_at is null;

insert into public.workspace_items(workspace_id, resource_id, order_index)
select owner_workspace.id, p.id, p.order_index
from public.pages p
join public.workspaces owner_workspace on owner_workspace.owner_id = p.original_owner_id
on conflict (workspace_id, resource_id) do nothing;

insert into public.pending_resource_shares(resource_id, username, can_invite, granted_by, expires_at)
select p.id, pa.username, false, w.owner_id, pa.expires_at
from public.pending_accounts pa
join public.workspaces w on w.id = pa.workspace_id
join public.pages p on p.workspace_id = pa.workspace_id and p.parent_id is null
where pa.accepted_at is null and pa.expires_at > now()
on conflict (resource_id, username) where accepted_at is null and revoked_at is null
do update set expires_at = greatest(pending_resource_shares.expires_at, excluded.expires_at);

insert into public.resource_shares(resource_id, user_id, can_invite, granted_by)
select prs.resource_id, recipient.id, prs.can_invite, prs.granted_by
from public.pending_resource_shares prs
join public.profiles recipient on recipient.username = prs.username
  and recipient.account_status = 'approved'
join public.pages p on p.id = prs.resource_id and p.deleted_at is null
where prs.accepted_at is null and prs.revoked_at is null and prs.expires_at > now()
  and p.original_owner_id <> recipient.id
on conflict (resource_id, user_id) where revoked_at is null do nothing;

update public.pending_resource_shares
set accepted_by = recipient.id, accepted_at = now()
from public.profiles recipient
where pending_resource_shares.username = recipient.username
  and recipient.account_status = 'approved'
  and pending_resource_shares.accepted_at is null
  and pending_resource_shares.revoked_at is null
  and pending_resource_shares.expires_at > now()
  and exists (
    select 1 from public.resource_shares rs
    where rs.resource_id = pending_resource_shares.resource_id
      and rs.user_id = recipient.id and rs.revoked_at is null
  );

insert into public.workspace_items(workspace_id, resource_id, order_index)
select personal.id, rs.resource_id,
  coalesce((select max(wi.order_index) + 1 from public.workspace_items wi where wi.workspace_id = personal.id), 0)
from public.resource_shares rs
join public.workspaces personal on personal.owner_id = rs.user_id
where rs.revoked_at is null
on conflict (workspace_id, resource_id) do nothing;

create unique index if not exists profiles_one_site_admin_idx
on public.profiles((is_site_admin)) where is_site_admin;

drop function if exists public.get_workspace_tree(uuid);

create or replace function public.has_inherited_resource_access(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  with recursive ancestors(resource_id, path) as (
    select fi.folder_id, array[target_resource_id, fi.folder_id]
    from public.folder_items fi
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where fi.child_resource_id = target_resource_id
    union all
    select fi.folder_id, a.path || fi.folder_id
    from ancestors a
    join public.folder_items fi on fi.child_resource_id = a.resource_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where not fi.folder_id = any(a.path)
  )
  select public.is_account_approved(target_user_id) and exists (
    select 1 from ancestors a
    join public.pages p on p.id = a.resource_id and p.deleted_at is null
    where p.original_owner_id = target_user_id
       or exists (
         select 1 from public.resource_shares rs
         where rs.resource_id = a.resource_id and rs.user_id = target_user_id and rs.revoked_at is null
       )
  );
$$;

create or replace function public.can_invite_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, s.path || fi.folder_id
    from scope s
    join public.folder_items fi on fi.child_resource_id = s.resource_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where not fi.folder_id = any(s.path)
  )
  select public.is_account_approved(target_user_id) and exists (
    select 1 from scope s
    join public.pages p on p.id = s.resource_id and p.deleted_at is null
    where p.original_owner_id = target_user_id
       or exists (
         select 1 from public.resource_shares rs
         where rs.resource_id = s.resource_id and rs.user_id = target_user_id
           and rs.revoked_at is null and rs.can_invite
       )
  );
$$;

create or replace function public.get_resource_permissions(target_resource_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'canView', public.can_view_resource(target_resource_id, auth.uid()),
    'canEdit', public.can_edit_resource(target_resource_id, auth.uid()),
    'canInvite', public.can_invite_resource(target_resource_id, auth.uid()),
    'canManage', public.can_manage_resource_shares(target_resource_id, auth.uid()),
    'isOriginalOwner', public.is_original_resource_owner(target_resource_id, auth.uid()),
    'canSelfRemove', public.has_direct_resource_share(target_resource_id, auth.uid())
  );
$$;

create or replace function public.touch_resource_audience(target_resource_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, scope.path || fi.folder_id
    from scope join public.folder_items fi on fi.child_resource_id = scope.resource_id
    where not fi.folder_id = any(scope.path)
  )
  update public.resource_shares
  set updated_at = now()
  where revoked_at is null and resource_id in (select resource_id from scope);
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, scope.path || fi.folder_id
    from scope join public.folder_items fi on fi.child_resource_id = scope.resource_id
    where not fi.folder_id = any(scope.path)
  )
  update public.pages
  set updated_at = now()
  where deleted_at is null and id in (select resource_id from scope);
end;
$$;

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
          select 1 from public.pages local_parent
          where local_parent.id = wi.parent_local_resource_id
            and local_parent.page_type = 'folder' and local_parent.deleted_at is null
            and public.can_view_resource(local_parent.id, auth.uid())
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
  ), preferred as (
    select distinct on (tree.resource_id) tree.*
    from tree
    order by tree.resource_id, tree.depth desc
  )
  select p.id, p.workspace_id, p.parent_id, p.page_type, p.title, p.icon,
    preferred.tree_order, p.is_archived, p.original_owner_id, p.deleted_at,
    p.created_at, p.updated_at, preferred.tree_parent_id, preferred.depth, preferred.relation,
    p.original_owner_id = auth.uid(), public.can_invite_resource(p.id, auth.uid()),
    public.has_direct_resource_share(p.id, auth.uid())
  from preferred join public.pages p on p.id = preferred.resource_id
  where public.is_account_approved(auth.uid()) and p.deleted_at is null
    and not p.is_archived and public.can_view_resource(p.id, auth.uid())
  order by preferred.depth, preferred.tree_order, p.created_at;
$$;

create or replace function public.create_resource(
  resource_type text,
  resource_title text default null,
  target_folder_id uuid default null
) returns public.pages language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
declare actor_workspace_id uuid;
declare created_resource public.pages;
declare next_order integer;
begin
  if not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if resource_type not in ('folder', 'log') then raise exception 'invalid resource type'; end if;
  select public.personal_workspace_id(actor_id) into actor_workspace_id;
  if actor_workspace_id is null then raise exception 'personal workspace not found'; end if;
  if target_folder_id is not null then
    if not public.can_edit_resource(target_folder_id, actor_id)
      or not exists (select 1 from public.pages where id = target_folder_id and page_type = 'folder' and deleted_at is null)
    then raise exception 'folder permission denied'; end if;
  end if;

  insert into public.pages(workspace_id, parent_id, page_type, title, created_by, original_owner_id)
  values (
    actor_workspace_id, null, resource_type,
    coalesce(nullif(trim(resource_title), ''), case when resource_type = 'log' then '제목 없는 로그' else '새 폴더' end),
    actor_id, actor_id
  ) returning * into created_resource;
  if resource_type = 'log' then insert into public.logs(page_id) values (created_resource.id); end if;

  select coalesce(max(order_index) + 1, 0) into next_order
  from public.workspace_items where workspace_id = actor_workspace_id and parent_local_resource_id is null;
  insert into public.workspace_items(workspace_id, resource_id, order_index)
  values (actor_workspace_id, created_resource.id, next_order);

  if target_folder_id is not null then
    select coalesce(max(order_index) + 1, 0) into next_order from public.folder_items where folder_id = target_folder_id;
    insert into public.folder_items(folder_id, child_resource_id, order_index, created_by)
    values (target_folder_id, created_resource.id, next_order, actor_id);
    perform public.touch_resource_audience(target_folder_id);
  end if;
  return created_resource;
end;
$$;

create or replace function public.move_workspace_item(target_resource_id uuid, target_parent_local_resource_id uuid default null, target_order integer default 0)
returns public.workspace_items language plpgsql security definer set search_path = public as $$
declare actor_workspace_id uuid;
declare moved_item public.workspace_items;
begin
  if not public.can_view_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  actor_workspace_id := public.personal_workspace_id(auth.uid());
  if actor_workspace_id is null then raise exception 'personal workspace not found'; end if;
  if target_parent_local_resource_id is not null then
    if target_parent_local_resource_id = target_resource_id
      or not public.can_view_resource(target_parent_local_resource_id, auth.uid())
      or not exists (select 1 from public.pages where id = target_parent_local_resource_id and page_type = 'folder' and deleted_at is null)
    then raise exception 'invalid local parent'; end if;
    if exists (
      with recursive edges(parent_id, child_id) as (
        select fi.folder_id, fi.child_resource_id from public.folder_items fi
        union
        select wi.parent_local_resource_id, wi.resource_id
        from public.workspace_items wi
        where wi.workspace_id = actor_workspace_id and wi.parent_local_resource_id is not null
      ), descendants(resource_id, path) as (
        select e.child_id, array[target_resource_id, e.child_id]
        from edges e where e.parent_id = target_resource_id
        union all
        select e.child_id, d.path || e.child_id
        from descendants d join edges e on e.parent_id = d.resource_id
        where not e.child_id = any(d.path)
      )
      select 1 from descendants where resource_id = target_parent_local_resource_id
    ) then raise exception 'workspace placement cycle'; end if;
  end if;
  insert into public.workspace_items(workspace_id, resource_id, parent_local_resource_id, order_index)
  values (actor_workspace_id, target_resource_id, target_parent_local_resource_id, greatest(target_order, 0))
  on conflict (workspace_id, resource_id) do update
    set parent_local_resource_id = excluded.parent_local_resource_id,
        order_index = excluded.order_index,
        updated_at = now()
  returning * into moved_item;
  return moved_item;
end;
$$;

create or replace function public.insert_folder_item(target_folder_id uuid, target_child_resource_id uuid, target_order integer default 0)
returns public.folder_items language plpgsql security definer set search_path = public as $$
declare created_item public.folder_items;
declare existing_folder_id uuid;
begin
  if not public.can_edit_resource(target_folder_id, auth.uid())
    or not public.can_view_resource(target_child_resource_id, auth.uid())
  then raise exception 'permission denied'; end if;
  if not exists (select 1 from public.pages where id = target_folder_id and page_type = 'folder' and deleted_at is null)
  then raise exception 'folder not found'; end if;
  perform public.assert_no_folder_cycle(target_folder_id, target_child_resource_id);

  select folder_id into existing_folder_id
  from public.folder_items where child_resource_id = target_child_resource_id;

  -- A first insertion into the shared hierarchy is a re-share, even when the target
  -- folder currently has no collaborators. Personal-only organization must use
  -- workspace_items, otherwise a collaborator could launder invite permission by
  -- inserting a foreign page into a private folder and sharing that folder later.
  if not public.can_invite_resource(target_child_resource_id, auth.uid()) then
    if existing_folder_id is null then raise exception 'reshare permission required'; end if;

    -- Editors may still reorder/move a child inside the same shared tree when that move
    -- introduces no new viewer. Moving it into an unrelated tree requires invite rights.
    if not exists (
      with recursive source_scope(resource_id, path) as (
        select existing_folder_id, array[existing_folder_id]
        union all
        select fi.folder_id, s.path || fi.folder_id
        from source_scope s
        join public.folder_items fi on fi.child_resource_id = s.resource_id
        join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
        where not fi.folder_id = any(s.path)
      ), target_scope(resource_id, path) as (
        select target_folder_id, array[target_folder_id]
        union all
        select fi.folder_id, s.path || fi.folder_id
        from target_scope s
        join public.folder_items fi on fi.child_resource_id = s.resource_id
        join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
        where not fi.folder_id = any(s.path)
      )
      select 1 from source_scope source
      join target_scope target on target.resource_id = source.resource_id
    ) or exists (
      select 1 from public.profiles audience
      where audience.account_status = 'approved'
        and public.can_view_resource(target_folder_id, audience.id)
        and not public.can_view_resource(target_child_resource_id, audience.id)
    ) then raise exception 'reshare permission required'; end if;
  end if;

  insert into public.folder_items(folder_id, child_resource_id, order_index, created_by)
  values (target_folder_id, target_child_resource_id, greatest(target_order, 0), auth.uid())
  on conflict (child_resource_id) do update
    set folder_id = excluded.folder_id, order_index = excluded.order_index, updated_at = now()
  returning * into created_item;
  if existing_folder_id is not null and existing_folder_id <> target_folder_id then
    perform public.touch_resource_audience(existing_folder_id);
  end if;
  perform public.touch_resource_audience(target_folder_id);
  return created_item;
end;
$$;

create or replace function public.remove_folder_item(target_folder_id uuid, target_child_resource_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare removed boolean;
declare owner_workspace_id uuid;
declare next_order integer;
begin
  if not public.can_edit_resource(target_folder_id, auth.uid()) then raise exception 'permission denied'; end if;
  delete from public.folder_items where folder_id = target_folder_id and child_resource_id = target_child_resource_id;
  removed := found;
  if removed then
    perform public.touch_resource_audience(target_folder_id);
    select w.id into owner_workspace_id
    from public.pages p join public.workspaces w on w.owner_id = p.original_owner_id
    where p.id = target_child_resource_id;
    if owner_workspace_id is not null then
      select coalesce(max(order_index) + 1, 0) into next_order
      from public.workspace_items
      where workspace_id = owner_workspace_id and parent_local_resource_id is null;
      insert into public.workspace_items(workspace_id, resource_id, order_index)
      values (owner_workspace_id, target_child_resource_id, next_order)
      on conflict (workspace_id, resource_id) do nothing;
    end if;
  end if;
  return removed;
end;
$$;

create or replace function public.share_resource(target_resource_id uuid, target_username text, grant_can_invite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare normalized_username text := lower(trim(target_username));
declare recipient public.profiles;
declare recipient_workspace_id uuid;
declare created_share_id uuid;
begin
  if not public.can_invite_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  if grant_can_invite and not public.is_original_resource_owner(target_resource_id, auth.uid())
  then raise exception 'only the original owner can delegate invite permission'; end if;
  if char_length(normalized_username) not between 2 and 40
    or normalized_username !~ '^[[:alnum:]가-힣._-]+$'
  then raise exception 'invalid username'; end if;
  select * into recipient from public.profiles where username = normalized_username;
  if recipient.id = auth.uid() then raise exception 'cannot share with yourself'; end if;

  if recipient.id is not null and recipient.account_status = 'approved' then
    if public.is_original_resource_owner(target_resource_id, recipient.id) then raise exception 'user is the original owner'; end if;
    select id into created_share_id from public.resource_shares
    where resource_id = target_resource_id and user_id = recipient.id and revoked_at is null;
    if created_share_id is not null then
      if grant_can_invite then
        update public.resource_shares set can_invite = true where id = created_share_id;
      end if;
      recipient_workspace_id := public.personal_workspace_id(recipient.id);
      insert into public.workspace_items(workspace_id, resource_id, order_index)
      select recipient_workspace_id, target_resource_id, coalesce(max(order_index) + 1, 0)
      from public.workspace_items where workspace_id = recipient_workspace_id
      on conflict (workspace_id, resource_id) do nothing;
      return jsonb_build_object('state', 'active', 'shareId', created_share_id,
        'username', normalized_username, 'alreadyShared', true);
    end if;
    insert into public.resource_shares(resource_id, user_id, can_invite, granted_by)
    values (target_resource_id, recipient.id, grant_can_invite, auth.uid())
    returning id into created_share_id;
    recipient_workspace_id := public.personal_workspace_id(recipient.id);
    insert into public.workspace_items(workspace_id, resource_id, order_index)
    select recipient_workspace_id, target_resource_id, coalesce(max(order_index) + 1, 0)
    from public.workspace_items where workspace_id = recipient_workspace_id
    on conflict (workspace_id, resource_id) do nothing;
    return jsonb_build_object('state', 'active', 'shareId', created_share_id, 'username', normalized_username);
  end if;

  insert into public.pending_resource_shares(resource_id, username, can_invite, granted_by)
  values (target_resource_id, normalized_username, grant_can_invite, auth.uid())
  on conflict (resource_id, username) where accepted_at is null and revoked_at is null
  do update set can_invite = excluded.can_invite, granted_by = excluded.granted_by,
    expires_at = now() + interval '30 days'
  returning id into created_share_id;
  return jsonb_build_object('state', 'pending', 'shareId', created_share_id, 'username', normalized_username);
end;
$$;

create or replace function public.self_remove_resource(target_resource_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
begin
  if not public.is_account_approved(actor_id) or public.is_original_resource_owner(target_resource_id, actor_id)
  then raise exception 'resource owner cannot self-remove'; end if;
  if not public.has_direct_resource_share(target_resource_id, actor_id) then
    raise exception 'direct share not found';
  end if;
  update public.resource_shares set revoked_at = now(), revoked_by = actor_id, revocation_reason = 'self_remove'
  where resource_id = target_resource_id and user_id = actor_id and revoked_at is null;
  delete from public.workspace_items
  where workspace_id = public.personal_workspace_id(actor_id) and resource_id = target_resource_id;
  return true;
end;
$$;

create or replace function public.trash_resource(target_resource_id uuid)
returns public.pages language plpgsql security definer set search_path = public as $$
declare trashed public.pages;
begin
  if not public.can_delete_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  update public.pages set deleted_at = now(), purge_after = now() + interval '30 days',
    deleted_by = auth.uid(), is_archived = true
  where id = target_resource_id and deleted_at is null returning * into trashed;
  if trashed.id is null then raise exception 'resource not found'; end if;
  update public.publications set is_active = false where page_id = target_resource_id;
  perform public.touch_resource_audience(target_resource_id);
  return trashed;
end;
$$;

create or replace function public.restore_resource(target_resource_id uuid)
returns public.pages language plpgsql security definer set search_path = public as $$
declare restored public.pages;
begin
  if not public.is_account_approved(auth.uid()) or not exists (
    select 1 from public.pages where id = target_resource_id and original_owner_id = auth.uid() and deleted_at is not null
  ) then raise exception 'permission denied'; end if;
  update public.pages set deleted_at = null, purge_after = null, deleted_by = null, is_archived = false
  where id = target_resource_id returning * into restored;
  perform public.touch_resource_audience(target_resource_id);
  return restored;
end;
$$;

create or replace function public.moderate_account(target_user_id uuid, decision text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
declare target_profile public.profiles;
declare target_workspace_id uuid;
declare prior_status text;
begin
  if not public.is_account_approved(actor_id) or not exists (
    select 1 from public.profiles where id = actor_id and is_site_admin
  ) then raise exception 'permission denied'; end if;
  if decision not in ('approve', 'reject') then raise exception 'invalid decision'; end if;
  if target_user_id = actor_id then raise exception 'cannot moderate the site administrator'; end if;
  select * into target_profile from public.profiles where id = target_user_id for update;
  if target_profile.id is null then raise exception 'account not found'; end if;
  prior_status := target_profile.account_status;

  if decision = 'reject' then
    update public.profiles set account_status = 'rejected', approved_at = null, approved_by = null
    where id = target_user_id returning * into target_profile;
    insert into public.account_approval_events(user_id, action, acted_by)
    values (target_user_id, 'rejected', actor_id);
    return target_profile;
  end if;

  update public.profiles set account_status = 'approved', approved_at = coalesce(approved_at, now()), approved_by = actor_id
  where id = target_user_id returning * into target_profile;
  insert into public.workspaces(name, owner_id)
  values (coalesce(nullif(target_profile.display_name, ''), target_profile.username) || '의 워크스페이스', target_user_id)
  on conflict (owner_id) do update set owner_id = excluded.owner_id
  returning id into target_workspace_id;
  insert into public.workspace_members(workspace_id, user_id, role)
  values (target_workspace_id, target_user_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';

  insert into public.resource_shares(resource_id, user_id, can_invite, granted_by)
  select prs.resource_id, target_user_id, prs.can_invite, prs.granted_by
  from public.pending_resource_shares prs
  join public.pages p on p.id = prs.resource_id and p.deleted_at is null
  where prs.username = target_profile.username and prs.accepted_at is null
    and prs.revoked_at is null and prs.expires_at > now()
    and not exists (
      select 1 from public.resource_shares rs
      where rs.resource_id = prs.resource_id and rs.user_id = target_user_id and rs.revoked_at is null
    );
  update public.pending_resource_shares
  set accepted_by = target_user_id, accepted_at = now()
  where username = target_profile.username and accepted_at is null and revoked_at is null and expires_at > now()
    and exists (
      select 1 from public.resource_shares rs
      join public.pages p on p.id = rs.resource_id and p.deleted_at is null
      where rs.resource_id = pending_resource_shares.resource_id
        and rs.user_id = target_user_id and rs.revoked_at is null
    );
  insert into public.workspace_items(workspace_id, resource_id, order_index)
  select target_workspace_id, rs.resource_id,
    row_number() over(order by rs.created_at)::integer - 1
  from public.resource_shares rs
  where rs.user_id = target_user_id and rs.revoked_at is null
  on conflict (workspace_id, resource_id) do nothing;

  insert into public.account_approval_events(user_id, action, acted_by)
  values (target_user_id, case when prior_status = 'approved' then 'reenabled' else 'approved' end, actor_id);
  return target_profile;
end;
$$;

drop policy if exists "owners create resource publications" on public.publications;
drop policy if exists "owners update resource publications" on public.publications;
create policy "owners create resource publications" on public.publications
for insert to authenticated with check (public.can_manage_resource_shares(page_id, auth.uid()));
create policy "owners update resource publications" on public.publications
for update to authenticated using (public.can_manage_resource_shares(page_id, auth.uid()))
with check (public.can_manage_resource_shares(page_id, auth.uid()));

drop trigger if exists resource_shares_set_updated_at on public.resource_shares;
create trigger resource_shares_set_updated_at before update on public.resource_shares
for each row execute function public.set_updated_at();

revoke execute on function public.is_workspace_member(uuid) from public, anon, authenticated;
revoke execute on function public.is_workspace_owner(uuid) from public, anon, authenticated;
revoke execute on function public.touch_resource_audience(uuid) from public, anon, authenticated;
revoke execute on function public.get_workspace_tree(uuid) from public, anon;

grant execute on function public.is_original_resource_owner(uuid, uuid) to authenticated;
grant execute on function public.has_direct_resource_share(uuid, uuid) to authenticated;
grant execute on function public.has_inherited_resource_access(uuid, uuid) to authenticated;
grant execute on function public.can_view_resource(uuid, uuid) to authenticated;
grant execute on function public.can_edit_resource(uuid, uuid) to authenticated;
grant execute on function public.can_invite_resource(uuid, uuid) to authenticated;
grant execute on function public.can_manage_resource_shares(uuid, uuid) to authenticated;
grant execute on function public.can_delete_resource(uuid, uuid) to authenticated;
grant execute on function public.personal_workspace_id(uuid) to authenticated;
grant execute on function public.get_workspace_tree(uuid) to authenticated;
