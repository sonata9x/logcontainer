-- Role-based registered-user share management. Ownership remains on
-- pages.original_owner_id and is projected into member lists only.

create or replace function public.create_resource_share(
  target_resource_id uuid,
  target_username text,
  target_access_level text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_role text := public.get_effective_resource_role(target_resource_id, auth.uid());
declare normalized_username text := lower(trim(target_username));
declare recipient public.profiles;
declare recipient_workspace_id uuid;
declare created_share_id uuid;
begin
  if actor_role not in ('admin', 'owner') then raise exception 'permission denied'; end if;
  if target_access_level not in ('viewer', 'editor', 'admin') then raise exception 'invalid access level'; end if;
  if actor_role = 'admin' and target_access_level = 'admin' then raise exception 'only owner can grant admin'; end if;
  if char_length(normalized_username) not between 2 and 40
    or normalized_username !~ '^[[:alnum:]가-힣._-]+$'
  then raise exception 'invalid username'; end if;

  select * into recipient from public.profiles where username = normalized_username;
  if recipient.id = auth.uid() then raise exception 'cannot share with yourself'; end if;

  if recipient.id is not null and recipient.account_status = 'approved' then
    if public.is_original_resource_owner(target_resource_id, recipient.id) then raise exception 'user is the original owner'; end if;
    select id into created_share_id from public.resource_shares
    where resource_id = target_resource_id and user_id = recipient.id and revoked_at is null for update;
    if created_share_id is null then
      insert into public.resource_shares(resource_id, user_id, access_level, can_invite, granted_by)
      values (target_resource_id, recipient.id, target_access_level, target_access_level = 'admin', auth.uid())
      returning id into created_share_id;
    else
      update public.resource_shares
      set access_level = target_access_level, can_invite = target_access_level = 'admin'
      where id = created_share_id;
    end if;
    recipient_workspace_id := public.personal_workspace_id(recipient.id);
    insert into public.workspace_items(workspace_id, resource_id, order_index)
    select recipient_workspace_id, target_resource_id, coalesce(max(order_index) + 1, 0)
    from public.workspace_items where workspace_id = recipient_workspace_id
    on conflict (workspace_id, resource_id) do nothing;
    return jsonb_build_object('state', 'active', 'shareId', created_share_id,
      'username', normalized_username, 'accessLevel', target_access_level);
  end if;

  insert into public.pending_resource_shares(resource_id, username, access_level, can_invite, granted_by)
  values (target_resource_id, normalized_username, target_access_level, target_access_level = 'admin', auth.uid())
  on conflict (resource_id, username) where accepted_at is null and revoked_at is null
  do update set access_level = excluded.access_level, can_invite = excluded.can_invite,
    granted_by = excluded.granted_by, expires_at = now() + interval '30 days'
  returning id into created_share_id;
  return jsonb_build_object('state', 'pending', 'shareId', created_share_id,
    'username', normalized_username, 'accessLevel', target_access_level);
end;
$$;

create or replace function public.list_resource_share_members(target_resource_id uuid)
returns table(
  share_id uuid, user_id uuid, username text, display_name text, access_level text,
  granted_by uuid, created_at timestamptz, state text, is_owner boolean
) language sql stable security definer set search_path = public as $$
  select null::uuid, owner_profile.id, owner_profile.username, owner_profile.display_name,
    'owner'::text, null::uuid, page.created_at, 'active'::text, true
  from public.pages page
  join public.profiles owner_profile on owner_profile.id = page.original_owner_id
  where page.id = target_resource_id
    and public.can_manage_resource_shares(target_resource_id, auth.uid())
  union all
  select rs.id, rs.user_id, profile.username, profile.display_name, rs.access_level,
    rs.granted_by, rs.created_at, 'active'::text, false
  from public.resource_shares rs join public.profiles profile on profile.id = rs.user_id
  where rs.resource_id = target_resource_id and rs.revoked_at is null
    and public.can_manage_resource_shares(target_resource_id, auth.uid())
  union all
  select prs.id, null::uuid, prs.username, null::text, prs.access_level,
    prs.granted_by, prs.created_at, 'pending'::text, false
  from public.pending_resource_shares prs
  where prs.resource_id = target_resource_id and prs.accepted_at is null and prs.revoked_at is null
    and prs.expires_at > now() and public.can_manage_resource_shares(target_resource_id, auth.uid())
  order by is_owner desc, created_at;
$$;

create or replace function public.update_resource_share_role(
  target_share_id uuid,
  target_state text,
  next_access_level text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare resource_id uuid;
declare current_access_level text;
declare actor_role text;
begin
  if target_state not in ('active', 'pending') or next_access_level not in ('viewer', 'editor', 'admin')
  then raise exception 'invalid share update'; end if;
  if target_state = 'active' then
    select share.resource_id, share.access_level into resource_id, current_access_level
    from public.resource_shares share where share.id = target_share_id and share.revoked_at is null for update;
  else
    select share.resource_id, share.access_level into resource_id, current_access_level
    from public.pending_resource_shares share
    where share.id = target_share_id and share.accepted_at is null and share.revoked_at is null
      and share.expires_at > now() for update;
  end if;
  if resource_id is null then raise exception 'share not found'; end if;
  actor_role := public.get_effective_resource_role(resource_id, auth.uid());
  if actor_role not in ('admin', 'owner') then raise exception 'permission denied'; end if;
  if actor_role = 'admin' and (current_access_level = 'admin' or next_access_level = 'admin')
  then raise exception 'only owner can manage admin shares'; end if;

  if target_state = 'active' then
    update public.resource_shares set access_level = next_access_level,
      can_invite = next_access_level = 'admin' where id = target_share_id;
  else
    update public.pending_resource_shares set access_level = next_access_level,
      can_invite = next_access_level = 'admin' where id = target_share_id;
  end if;
  return jsonb_build_object('shareId', target_share_id, 'state', target_state,
    'accessLevel', next_access_level);
end;
$$;

create or replace function public.revoke_resource_share_role(
  target_share_id uuid,
  target_state text
) returns boolean language plpgsql security definer set search_path = public as $$
declare managed_resource_id uuid;
declare target_user_id uuid;
declare current_access_level text;
declare actor_role text;
begin
  if target_state not in ('active', 'pending') then raise exception 'invalid share state'; end if;
  if target_state = 'active' then
    select share.resource_id, share.user_id, share.access_level
    into managed_resource_id, target_user_id, current_access_level
    from public.resource_shares share where share.id = target_share_id and share.revoked_at is null for update;
  else
    select share.resource_id, null::uuid, share.access_level
    into managed_resource_id, target_user_id, current_access_level
    from public.pending_resource_shares share
    where share.id = target_share_id and share.accepted_at is null and share.revoked_at is null for update;
  end if;
  if managed_resource_id is null then raise exception 'share not found'; end if;
  actor_role := public.get_effective_resource_role(managed_resource_id, auth.uid());
  if actor_role not in ('admin', 'owner') then raise exception 'permission denied'; end if;
  if actor_role = 'admin' and current_access_level = 'admin'
  then raise exception 'only owner can revoke admin shares'; end if;

  if target_state = 'active' then
    update public.resource_shares set revoked_at = now(), revoked_by = auth.uid(),
      revocation_reason = 'role_manager_revoke' where id = target_share_id;
    delete from public.workspace_items
    where workspace_id = public.personal_workspace_id(target_user_id)
      and resource_id = managed_resource_id;
  else
    update public.pending_resource_shares set revoked_at = now() where id = target_share_id;
  end if;
  return true;
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
  on conflict (owner_id) do update set owner_id = excluded.owner_id returning id into target_workspace_id;
  insert into public.workspace_members(workspace_id, user_id, role)
  values (target_workspace_id, target_user_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  insert into public.resource_shares(resource_id, user_id, access_level, can_invite, granted_by)
  select prs.resource_id, target_user_id, prs.access_level, prs.access_level = 'admin', prs.granted_by
  from public.pending_resource_shares prs
  join public.pages page on page.id = prs.resource_id and page.deleted_at is null
  where prs.username = target_profile.username and prs.accepted_at is null
    and prs.revoked_at is null and prs.expires_at > now()
    and not exists (select 1 from public.resource_shares rs
      where rs.resource_id = prs.resource_id and rs.user_id = target_user_id and rs.revoked_at is null);
  update public.pending_resource_shares set accepted_by = target_user_id, accepted_at = now()
  where username = target_profile.username and accepted_at is null and revoked_at is null and expires_at > now()
    and exists (select 1 from public.resource_shares rs
      join public.pages page on page.id = rs.resource_id and page.deleted_at is null
      where rs.resource_id = pending_resource_shares.resource_id
        and rs.user_id = target_user_id and rs.revoked_at is null);
  insert into public.workspace_items(workspace_id, resource_id, order_index)
  select target_workspace_id, rs.resource_id, row_number() over(order by rs.created_at)::integer - 1
  from public.resource_shares rs where rs.user_id = target_user_id and rs.revoked_at is null
  on conflict (workspace_id, resource_id) do nothing;
  insert into public.account_approval_events(user_id, action, acted_by)
  values (target_user_id, case when prior_status = 'approved' then 'reenabled' else 'approved' end, actor_id);
  return target_profile;
end;
$$;

revoke all on function public.create_resource_share(uuid, text, text) from public, anon;
revoke all on function public.list_resource_share_members(uuid) from public, anon;
revoke all on function public.update_resource_share_role(uuid, text, text) from public, anon;
revoke all on function public.revoke_resource_share_role(uuid, text) from public, anon;
grant execute on function public.create_resource_share(uuid, text, text) to authenticated;
grant execute on function public.list_resource_share_members(uuid) to authenticated;
grant execute on function public.update_resource_share_role(uuid, text, text) to authenticated;
grant execute on function public.revoke_resource_share_role(uuid, text) to authenticated;
