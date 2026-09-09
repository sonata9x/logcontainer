-- Page-scoped handout library with private image assets.

create table if not exists public.handouts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  title text not null,
  content text not null default '',
  order_index integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handouts_title_length check (char_length(title) between 1 and 200),
  constraint handouts_content_length check (char_length(content) <= 200000)
);

create index if not exists handouts_page_order_idx
on public.handouts(page_id, order_index, created_at);

create table if not exists public.handout_images (
  id uuid primary key default gen_random_uuid(),
  handout_id uuid not null references public.handouts(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  byte_size integer not null,
  order_index integer not null default 0,
  is_ready boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint handout_images_name_length check (char_length(original_name) between 1 and 255),
  constraint handout_images_mime check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  constraint handout_images_size check (byte_size between 1 and 10000000)
);

create index if not exists handout_images_handout_order_idx
on public.handout_images(handout_id, order_index, created_at);

alter table public.handouts enable row level security;
alter table public.handout_images enable row level security;

drop policy if exists handouts_select on public.handouts;
create policy handouts_select on public.handouts for select to authenticated
using (public.can_view_resource(page_id, auth.uid()));

drop policy if exists handouts_insert on public.handouts;
create policy handouts_insert on public.handouts for insert to authenticated
with check (created_by = auth.uid() and public.can_edit_resource(page_id, auth.uid()));

drop policy if exists handouts_update on public.handouts;
create policy handouts_update on public.handouts for update to authenticated
using (public.can_edit_resource(page_id, auth.uid()))
with check (public.can_edit_resource(page_id, auth.uid()));

drop policy if exists handouts_delete on public.handouts;
create policy handouts_delete on public.handouts for delete to authenticated
using (public.can_edit_resource(page_id, auth.uid()));

drop policy if exists handout_images_select on public.handout_images;
create policy handout_images_select on public.handout_images for select to authenticated
using (exists (
  select 1 from public.handouts handout
  where handout.id = public.handout_images.handout_id and public.can_view_resource(handout.page_id, auth.uid())
));

drop policy if exists handout_images_insert on public.handout_images;
create policy handout_images_insert on public.handout_images for insert to authenticated
with check (created_by = auth.uid() and exists (
  select 1 from public.handouts handout
  where handout.id = public.handout_images.handout_id and public.can_edit_resource(handout.page_id, auth.uid())
));

drop policy if exists handout_images_update on public.handout_images;
create policy handout_images_update on public.handout_images for update to authenticated
using (exists (
  select 1 from public.handouts handout
  where handout.id = public.handout_images.handout_id and public.can_edit_resource(handout.page_id, auth.uid())
));

drop policy if exists handout_images_delete on public.handout_images;
create policy handout_images_delete on public.handout_images for delete to authenticated
using (exists (
  select 1 from public.handouts handout
  where handout.id = public.handout_images.handout_id and public.can_edit_resource(handout.page_id, auth.uid())
));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'handout-images',
  'handout-images',
  false,
  10000000,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on public.handouts from anon;
revoke all on public.handout_images from anon;
grant select, insert, update, delete on public.handouts to authenticated;
grant select, insert, update, delete on public.handout_images to authenticated;
