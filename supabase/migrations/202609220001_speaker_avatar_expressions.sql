-- Roll20 / Takoyaki speaker avatar defaults and per-entry expressions.
-- Canonical log documents remain immutable; presentation choices live separately.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'speaker-avatars',
  'speaker-avatars',
  false,
  5000000,
  array['image/png','image/jpeg','image/gif','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.page_speaker_profiles (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  speaker_key text not null check (char_length(speaker_key) between 1 and 200),
  speaker_name text not null check (char_length(trim(speaker_name)) between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, speaker_key)
);

create table if not exists public.speaker_avatar_variants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.page_speaker_profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  name_key text not null check (char_length(name_key) between 1 and 80),
  is_default boolean not null default false,
  storage_path text not null unique,
  original_filename text,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/gif','image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5000000),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, name_key)
);

create unique index if not exists speaker_avatar_one_default_idx
on public.speaker_avatar_variants(profile_id) where is_default;

create table if not exists public.log_entry_avatar_overrides (
  entry_id uuid primary key references public.log_entries(id) on delete cascade,
  variant_id uuid not null references public.speaker_avatar_variants(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists page_speaker_profiles_page_idx on public.page_speaker_profiles(page_id);
create index if not exists speaker_avatar_variants_profile_idx on public.speaker_avatar_variants(profile_id, sort_order, created_at);
create index if not exists log_entry_avatar_overrides_variant_idx on public.log_entry_avatar_overrides(variant_id);

alter table public.page_speaker_profiles enable row level security;
alter table public.speaker_avatar_variants enable row level security;
alter table public.log_entry_avatar_overrides enable row level security;
revoke all on public.page_speaker_profiles, public.speaker_avatar_variants, public.log_entry_avatar_overrides from public, anon, authenticated;
grant all on public.page_speaker_profiles, public.speaker_avatar_variants, public.log_entry_avatar_overrides to service_role;

-- The application APIs authenticate both account and guest editors before using
-- the service role. Storage itself stays private and has no client object policy;
-- clients can only upload to a one-off signed target.

alter table public.log_change_events drop constraint if exists log_change_events_event_type_check;
alter table public.log_change_events add constraint log_change_events_event_type_check
check (event_type in ('inserted', 'updated', 'deleted', 'restored', 'log_replaced', 'speaker_avatars_changed'));

alter table public.storage_deletion_queue drop constraint if exists storage_deletion_queue_bucket_check;
alter table public.storage_deletion_queue add constraint storage_deletion_queue_bucket_check
check (bucket in ('session-cards','handout-images','roll20-source-archives','log-generation-archives','roll20-import-staging','speaker-avatars'));

create or replace function public.enqueue_speaker_avatar_object()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.storage_deletion_queue(bucket, storage_path)
  values ('speaker-avatars', old.storage_path)
  on conflict do nothing;
  return old;
end;
$$;

drop trigger if exists speaker_avatar_private_cleanup on public.speaker_avatar_variants;
create trigger speaker_avatar_private_cleanup
before delete on public.speaker_avatar_variants
for each row execute function public.enqueue_speaker_avatar_object();

revoke execute on function public.enqueue_speaker_avatar_object() from public, anon, authenticated;
grant execute on function public.enqueue_speaker_avatar_object() to service_role;

create or replace function public.list_page_log_speakers(target_page_id uuid)
returns table(speaker_name text, message_count bigint)
language sql security definer set search_path = public as $$
  select (array_agg(trim(e.speaker_name) order by e.sort_key))[1], count(*)
  from public.logs l
  join public.log_entries e on e.log_id = l.id
  where l.page_id = target_page_id
    and not e.is_deleted
    and nullif(trim(e.speaker_name), '') is not null
  group by lower(regexp_replace(trim(e.speaker_name), '\s+', ' ', 'g'))
  order by min(e.sort_key);
$$;
revoke execute on function public.list_page_log_speakers(uuid) from public, anon, authenticated;
grant execute on function public.list_page_log_speakers(uuid) to service_role;
