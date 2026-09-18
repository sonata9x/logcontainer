-- Emergency operator-only script: run in the trusted Supabase SQL Editor only
-- AFTER confirming the crashed/failed server request is no longer running.
-- Does not reset a password or return any credentials. Allows fresh login with
-- the password that Auth actually accepted; old sessions remain blocked.
begin;
do $$
declare target_id uuid;
begin
  select id into target_id from public.profiles where is_site_admin for update;
  if target_id is null then raise exception 'site administrator not found'; end if;
  update public.account_security_state set pending_operation=null,
    operation_started_at=null,sessions_valid_after=clock_timestamp()
  where user_id=target_id and pending_operation is not null
    and operation_started_at<now()-interval '15 minutes';
  if not found then raise exception 'no stale administrator password operation'; end if;
  update public.account_recovery_tokens set revoked_at=now()
  where user_id=target_id and used_at is null and revoked_at is null;
  insert into public.account_security_events(user_id,actor_id,action)
    values(target_id,target_id,'operation_aborted');
end;
$$;
commit;
