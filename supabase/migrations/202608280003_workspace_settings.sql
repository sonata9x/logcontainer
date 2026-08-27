-- Update the approved account's nickname and personal Workspace name atomically.

create or replace function public.update_personal_settings(
  next_workspace_name text,
  next_nickname text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor_id uuid := auth.uid();
  normalized_workspace_name text := trim(coalesce(next_workspace_name, ''));
  normalized_nickname text := trim(coalesce(next_nickname, ''));
  target_workspace public.workspaces;
  target_profile public.profiles;
begin
  if not public.is_account_approved(actor_id) then
    raise exception 'permission denied';
  end if;
  if char_length(normalized_workspace_name) not between 1 and 100 then
    raise exception 'workspace name must be between 1 and 100 characters';
  end if;
  if char_length(normalized_nickname) not between 1 and 80 then
    raise exception 'nickname must be between 1 and 80 characters';
  end if;

  select * into target_workspace
  from public.workspaces
  where owner_id = actor_id
  for update;
  if target_workspace.id is null then
    raise exception 'personal workspace not found';
  end if;

  update public.profiles
  set display_name = normalized_nickname, updated_at = now()
  where id = actor_id
  returning * into target_profile;
  if target_profile.id is null then
    raise exception 'profile not found';
  end if;

  update public.workspaces
  set name = normalized_workspace_name, updated_at = now()
  where id = target_workspace.id
  returning * into target_workspace;

  return jsonb_build_object(
    'nickname', target_profile.display_name,
    'workspaceName', target_workspace.name,
    'updatedAt', greatest(target_profile.updated_at, target_workspace.updated_at)
  );
end;
$$;

revoke all on function public.update_personal_settings(text, text) from public, anon;
grant execute on function public.update_personal_settings(text, text) to authenticated;
