-- Optional page extras, reusable BGM assets, personal libraries and playlists.

alter table public.pages add column if not exists overview text;
alter table public.pages add column if not exists font_family text not null default 'pretendard';
alter table public.pages add column if not exists session_card_path text;
alter table public.pages add column if not exists session_card_mime text;
alter table public.pages add column if not exists session_card_size integer;
alter table public.pages drop constraint if exists pages_overview_length;
alter table public.pages add constraint pages_overview_length check (overview is null or char_length(overview) <= 20000);
alter table public.pages drop constraint if exists pages_font_family_check;
alter table public.pages add constraint pages_font_family_check check (font_family in ('pretendard','gowoon-dodum','goun-batang','ridi-batang','nanum-myeongjo','natural-sans','ibm-plex-sans'));
alter table public.pages drop constraint if exists pages_session_card_metadata_check;
alter table public.pages add constraint pages_session_card_metadata_check check (
  (session_card_path is null and session_card_mime is null and session_card_size is null)
  or (session_card_path is not null and session_card_mime in ('image/png','image/jpeg','image/gif','image/webp') and session_card_size between 1 and 10000000)
);

create table if not exists public.bgm_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  source_type text not null check (source_type in ('upload','youtube')),
  storage_path text unique,
  youtube_url text,
  youtube_video_id text,
  canonical_title text not null,
  duration_seconds integer,
  mime_type text,
  byte_size integer,
  is_ready boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bgm_assets_title_length check (char_length(trim(canonical_title)) between 1 and 200),
  constraint bgm_assets_duration_check check (duration_seconds is null or duration_seconds between 0 and 86400),
  constraint bgm_assets_source_check check (
    (source_type = 'upload' and storage_path is not null and youtube_url is null and youtube_video_id is null and mime_type = 'audio/mpeg' and byte_size between 1 and 25000000)
    or (source_type = 'youtube' and storage_path is null and youtube_url is not null and youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' and mime_type is null and byte_size is null)
  )
);

create table if not exists public.bgm_library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bgm_asset_id uuid not null references public.bgm_assets(id) on delete restrict,
  custom_title text,
  created_at timestamptz not null default now(),
  constraint bgm_library_items_unique unique(user_id, bgm_asset_id),
  constraint bgm_library_custom_title_length check (custom_title is null or char_length(trim(custom_title)) between 1 and 200)
);

create table if not exists public.bgm_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_page_id uuid references public.pages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bgm_playlists_title_length check (char_length(trim(title)) between 1 and 200)
);
create unique index if not exists bgm_playlists_linked_page_idx on public.bgm_playlists(user_id, source_page_id) where source_page_id is not null;

create table if not exists public.bgm_playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.bgm_playlists(id) on delete cascade,
  bgm_asset_id uuid not null references public.bgm_assets(id) on delete restrict,
  custom_title text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint bgm_playlist_items_unique unique(playlist_id, bgm_asset_id),
  constraint bgm_playlist_custom_title_length check (custom_title is null or char_length(trim(custom_title)) between 1 and 200)
);
create index if not exists bgm_playlist_items_order_idx on public.bgm_playlist_items(playlist_id, sort_order, created_at);

create table if not exists public.page_bgm_items (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  bgm_asset_id uuid not null references public.bgm_assets(id) on delete restrict,
  role text not null check (role in ('waiting','entry')),
  entry_id uuid references public.log_entries(id) on delete cascade,
  sort_order integer not null default 0,
  custom_title text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint page_bgm_role_entry_check check ((role = 'waiting' and entry_id is null) or (role = 'entry' and entry_id is not null)),
  constraint page_bgm_custom_title_length check (custom_title is null or char_length(trim(custom_title)) between 1 and 200)
);
create unique index if not exists page_bgm_items_unique_use_idx on public.page_bgm_items(page_id, bgm_asset_id, role, coalesce(entry_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists page_bgm_items_page_order_idx on public.page_bgm_items(page_id, role, sort_order, created_at);
create index if not exists page_bgm_items_entry_idx on public.page_bgm_items(entry_id) where entry_id is not null;

create or replace function public.can_access_bgm_asset(target_asset_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select target_user_id is not null and exists (
    select 1 from public.bgm_assets asset where asset.id = target_asset_id and asset.deleted_at is null and (
      asset.owner_user_id = target_user_id
      or (asset.is_ready and (
        exists (select 1 from public.bgm_library_items library where library.bgm_asset_id = asset.id and library.user_id = target_user_id)
        or exists (select 1 from public.bgm_playlists playlist join public.bgm_playlist_items item on item.playlist_id = playlist.id where item.bgm_asset_id = asset.id and playlist.user_id = target_user_id)
        or exists (select 1 from public.page_bgm_items usage where usage.bgm_asset_id = asset.id and public.can_view_resource(usage.page_id, target_user_id))
      ))
    )
  );
$$;

create or replace function public.sync_page_bgm_to_linked_playlists()
returns trigger language plpgsql security definer set search_path = public set row_security = off as $$
begin
  insert into public.bgm_playlist_items(playlist_id, bgm_asset_id, custom_title, sort_order)
  select playlist.id, new.bgm_asset_id, new.custom_title,
    coalesce((select max(item.sort_order) + 1 from public.bgm_playlist_items item where item.playlist_id = playlist.id), 0)
  from public.bgm_playlists playlist
  where playlist.source_page_id = new.page_id
  on conflict (playlist_id, bgm_asset_id) do nothing;
  return new;
end;
$$;

drop trigger if exists page_bgm_sync_linked_playlists on public.page_bgm_items;
create trigger page_bgm_sync_linked_playlists after insert on public.page_bgm_items
for each row execute function public.sync_page_bgm_to_linked_playlists();
drop trigger if exists bgm_assets_set_updated_at on public.bgm_assets;
create trigger bgm_assets_set_updated_at before update on public.bgm_assets for each row execute function public.set_updated_at();
drop trigger if exists bgm_playlists_set_updated_at on public.bgm_playlists;
create trigger bgm_playlists_set_updated_at before update on public.bgm_playlists for each row execute function public.set_updated_at();

alter table public.bgm_assets enable row level security;
alter table public.bgm_library_items enable row level security;
alter table public.bgm_playlists enable row level security;
alter table public.bgm_playlist_items enable row level security;
alter table public.page_bgm_items enable row level security;

create policy bgm_assets_select on public.bgm_assets for select to authenticated using (public.can_access_bgm_asset(id, auth.uid()));
create policy bgm_assets_insert on public.bgm_assets for insert to authenticated with check (owner_user_id = auth.uid());
create policy bgm_assets_update on public.bgm_assets for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy bgm_library_select on public.bgm_library_items for select to authenticated using (user_id = auth.uid());
create policy bgm_library_insert on public.bgm_library_items for insert to authenticated with check (user_id = auth.uid() and public.can_access_bgm_asset(bgm_asset_id, auth.uid()));
create policy bgm_library_update on public.bgm_library_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bgm_library_delete on public.bgm_library_items for delete to authenticated using (user_id = auth.uid());
create policy bgm_playlists_all on public.bgm_playlists for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and (source_page_id is null or public.can_view_resource(source_page_id, auth.uid())));
create policy bgm_playlist_items_all on public.bgm_playlist_items for all to authenticated
using (exists (select 1 from public.bgm_playlists playlist where playlist.id = playlist_id and playlist.user_id = auth.uid()))
with check (exists (select 1 from public.bgm_playlists playlist where playlist.id = playlist_id and playlist.user_id = auth.uid()) and public.can_access_bgm_asset(bgm_asset_id, auth.uid()));
create policy page_bgm_select on public.page_bgm_items for select to authenticated using (public.can_view_resource(page_id, auth.uid()));
create policy page_bgm_insert on public.page_bgm_items for insert to authenticated with check (created_by = auth.uid() and public.can_edit_resource(page_id, auth.uid()) and public.can_access_bgm_asset(bgm_asset_id, auth.uid()));
create policy page_bgm_update on public.page_bgm_items for update to authenticated using (public.can_edit_resource(page_id, auth.uid())) with check (public.can_edit_resource(page_id, auth.uid()));
create policy page_bgm_delete on public.page_bgm_items for delete to authenticated using (public.can_edit_resource(page_id, auth.uid()));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('bgm-audio','bgm-audio',false,25000000,array['audio/mpeg']::text[]),
  ('session-cards','session-cards',false,10000000,array['image/png','image/jpeg','image/gif','image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

revoke all on public.bgm_assets, public.bgm_library_items, public.bgm_playlists, public.bgm_playlist_items, public.page_bgm_items from anon;
grant select, insert, update on public.bgm_assets to authenticated;
grant select, insert, update, delete on public.bgm_library_items, public.bgm_playlists, public.bgm_playlist_items, public.page_bgm_items to authenticated;
revoke all on function public.can_access_bgm_asset(uuid, uuid) from public, anon;
grant execute on function public.can_access_bgm_asset(uuid, uuid) to authenticated;
