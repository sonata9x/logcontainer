-- One-time private staging area for Roll20 HTML uploaded directly to Storage.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'roll20-import-staging',
  'roll20-import-staging',
  false,
  12582912,
  array['text/html']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.log_import_uploads (
  id uuid primary key,
  page_id uuid not null references public.pages(id) on delete cascade,
  log_id uuid not null references public.logs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 12582912),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (storage_path ~ '^pending/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]html$')
);

create index if not exists log_import_uploads_expiry_idx
on public.log_import_uploads(expires_at);

alter table public.log_import_uploads enable row level security;
revoke all on table public.log_import_uploads from public, anon, authenticated;
grant select, insert, update, delete on table public.log_import_uploads to service_role;
