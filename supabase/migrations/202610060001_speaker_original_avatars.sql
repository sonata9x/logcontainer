-- Resolve each speaker's immutable import-time avatar without exposing raw
-- canonical documents to the browser. Service-role callers use this to show
-- and optionally preserve the imported default avatar.
create or replace function public.list_page_log_speaker_original_avatars(target_page_id uuid)
returns table(speaker_key text, avatar_url text)
language sql security definer set search_path = public as $$
  with candidates as (
    select
      lower(regexp_replace(trim(coalesce(
        e.original_document #>> '{speaker,name}',
        e.document #>> '{speaker,name}',
        e.speaker_name
      )), '\s+', ' ', 'g')) as normalized_speaker,
      nullif(trim(coalesce(
        e.original_document #>> '{speaker,avatarUrl}',
        e.document #>> '{speaker,avatarUrl}'
      )), '') as imported_avatar,
      e.sort_key
    from public.logs l
    join public.log_entries e on e.log_id = l.id
    where l.page_id = target_page_id
      and not e.is_deleted
      and e.document_version = 2
  )
  select normalized_speaker,
    (array_agg(imported_avatar order by sort_key) filter (where imported_avatar is not null))[1]
  from candidates
  where nullif(normalized_speaker, '') is not null
  group by normalized_speaker
  having count(imported_avatar) > 0;
$$;

revoke execute on function public.list_page_log_speaker_original_avatars(uuid) from public, anon, authenticated;
grant execute on function public.list_page_log_speaker_original_avatars(uuid) to service_role;
