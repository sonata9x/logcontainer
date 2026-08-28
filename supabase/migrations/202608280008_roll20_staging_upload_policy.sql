-- Authorize only active, server-issued staging targets for authenticated TUS uploads.
create or replace function public.can_upload_log_import(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.log_import_uploads upload
    join public.pages page on page.id = upload.page_id
    where upload.storage_path = object_name
      and upload.owner_id = auth.uid()
      and page.original_owner_id = auth.uid()
      and upload.consumed_at is null
      and upload.expires_at > now()
      and page.deleted_at is null
  );
$$;

revoke execute on function public.can_upload_log_import(text) from public, anon;
grant execute on function public.can_upload_log_import(text) to authenticated, service_role;

drop policy if exists roll20_import_staging_insert on storage.objects;
create policy roll20_import_staging_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'roll20-import-staging'
  and public.can_upload_log_import(name)
);

-- Storage returns inserted object metadata and resumable clients may inspect their
-- own in-progress object. The active intent check removes access after consumption.
drop policy if exists roll20_import_staging_select on storage.objects;
create policy roll20_import_staging_select
on storage.objects for select to authenticated
using (
  bucket_id = 'roll20-import-staging'
  and owner_id = (select auth.uid()::text)
  and public.can_upload_log_import(name)
);
