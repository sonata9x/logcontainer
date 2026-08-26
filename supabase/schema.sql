create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (char_length(username) between 2 and 40 and username ~ '^[[:alnum:]가-힣._-]+$' and username = lower(trim(username)))
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default '나의 TRPG 로그',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.pending_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  username text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  constraint pending_accounts_username_normalized check (username = lower(trim(username))),
  constraint pending_accounts_workspace_username_key unique(workspace_id, username)
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.pages(id) on delete cascade,
  page_type text not null default 'log' check (page_type in ('folder', 'log')),
  title text not null default '제목 없음',
  icon text,
  order_index integer not null default 0,
  is_archived boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pages_workspace_parent_order_idx
on public.pages(workspace_id, parent_id, order_index);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null unique references public.pages(id) on delete cascade,
  platform text not null default 'manual' check (platform in ('manual', 'roll20', 'ccfolia', 'other')),
  original_html text,
  custom_css text,
  import_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.log_entries (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  order_index integer not null,
  entry_type text not null default 'dialogue' check (entry_type in ('dialogue', 'system', 'dice', 'image', 'handout', 'html')),
  speaker_name text,
  speaker_color text,
  content text not null default '',
  original_content text not null default '',
  raw_html text,
  metadata jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  is_added boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint log_entries_log_order_key unique(log_id, order_index) deferrable initially immediate
);

create table if not exists public.log_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.log_entries(id) on delete cascade,
  editor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('edit', 'delete', 'restore', 'revert')),
  previous_content text not null,
  next_content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.log_imports (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  source_html text not null,
  report jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.correction_settings (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null unique references public.logs(id) on delete cascade,
  remove_html_tags boolean not null default true,
  normalize_ellipsis boolean not null default true,
  normalize_quotes boolean not null default true,
  speaker_tab_format boolean not null default true,
  clean_blank_lines boolean not null default true,
  mark_handout_position boolean not null default true,
  custom_quote_open text not null default '“',
  custom_quote_close text not null default '”',
  custom_ellipsis text not null default '…',
  custom_handout_icon text not null default '★',
  updated_at timestamptz not null default now()
);

create index if not exists log_imports_log_created_idx on public.log_imports(log_id, created_at desc);

alter table public.log_entries replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'log_entries'
  ) then
    alter publication supabase_realtime add table public.log_entries;
  end if;
end;
$$;

create index if not exists log_entry_revisions_entry_created_idx
on public.log_entry_revisions(entry_id, created_at desc);

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null unique references public.pages(id) on delete cascade,
  token text not null unique default translate(rtrim(encode(gen_random_bytes(9), 'base64'), '='), '+/', '-_'),
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publications_token_format check (token ~ '^[A-Za-z0-9_-]{12}$')
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.correction_settings(log_id) values (new.id) on conflict (log_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_log_created on public.logs;
create trigger on_log_created after insert on public.logs for each row execute function public.handle_new_log();

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles', 'workspaces', 'pages', 'logs', 'log_entries', 'correction_settings', 'publications']
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_set_updated_at', table_name);
  end loop;
end;
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare new_workspace_id uuid;
declare invitation_count integer;
declare resolved_username text;
begin
  resolved_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if resolved_username = '' then raise exception 'username is required'; end if;
  insert into public.profiles(id, username, display_name)
  values (new.id, resolved_username, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), resolved_username));

  insert into public.workspace_members(workspace_id, user_id, role)
  select invitation.workspace_id, new.id, 'editor'
  from public.pending_accounts invitation
  where invitation.username = resolved_username
    and invitation.accepted_at is null
    and invitation.expires_at > now()
  on conflict (workspace_id, user_id) do nothing;
  get diagnostics invitation_count = row_count;

  if invitation_count > 0 then
    update public.pending_accounts
    set accepted_by = new.id, accepted_at = now()
    where username = resolved_username and accepted_at is null and expires_at > now();
  else
    insert into public.workspaces(name, owner_id)
    values ('나의 TRPG 로그', new.id)
    returning id into new_workspace_id;

    insert into public.workspace_members(workspace_id, user_id, role)
    values (new_workspace_id, new.id, 'owner');
  end if;
  return new;
end;
$$;

create or replace function public.replace_log_entries(
  target_page_id uuid,
  source_html text,
  source_platform text,
  report jsonb,
  entries jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare target_log_id uuid;
declare inserted_count integer;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then
    raise exception 'permission denied';
  end if;

  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;

  insert into public.log_imports(log_id, source_html, report, imported_by)
  values (target_log_id, source_html, report, auth.uid());
  update public.logs set original_html = source_html, platform = source_platform, import_report = report
  where id = target_log_id;
  delete from public.log_entries where log_id = target_log_id;

  insert into public.log_entries(
    log_id, order_index, entry_type, speaker_name, speaker_color,
    content, original_content, raw_html, metadata
  )
  select
    target_log_id, item.order_index, item.entry_type, item.speaker_name, item.speaker_color,
    item.content, item.original_content, item.raw_html, coalesce(item.metadata, '{}'::jsonb)
  from jsonb_to_recordset(entries) as item(
    order_index integer,
    entry_type text,
    speaker_name text,
    speaker_color text,
    content text,
    original_content text,
    raw_html text,
    metadata jsonb
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.update_log_entry_content(
  target_page_id uuid,
  target_entry_id uuid,
  next_content text,
  next_raw_html text,
  revision_action text default 'edit',
  expected_updated_at timestamptz default null
)
returns public.log_entries
language plpgsql
security definer
set search_path = public
as $$
declare target_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id and e.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another member';
  end if;

  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content)
  values (target_entry.id, auth.uid(), revision_action, target_entry.content, next_content);

  update public.log_entries set content = next_content, raw_html = next_raw_html,
    metadata = metadata || '{"edited": true}'::jsonb, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

create or replace function public.set_log_entry_deleted(
  target_page_id uuid,
  target_entry_id uuid,
  should_delete boolean
)
returns public.log_entries
language plpgsql
security definer
set search_path = public
as $$
declare target_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.is_deleted = should_delete then return target_entry; end if;

  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content)
  values (target_entry.id, auth.uid(), case when should_delete then 'delete' else 'restore' end, target_entry.content, target_entry.content);
  update public.log_entries set is_deleted = should_delete,
    deleted_at = case when should_delete then now() else null end, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

create or replace function public.create_log_entry(
  target_page_id uuid,
  after_entry_id uuid,
  new_entry_type text,
  new_speaker_name text,
  new_content text,
  new_raw_html text
)
returns public.log_entries
language plpgsql
security definer
set search_path = public
as $$
declare target_log_id uuid;
declare insert_index integer;
declare created_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;

  if after_entry_id is null then
    select coalesce(max(order_index), -1) + 1 into insert_index from public.log_entries where log_id = target_log_id;
  else
    select order_index + 1 into insert_index from public.log_entries where id = after_entry_id and log_id = target_log_id;
    if insert_index is null then raise exception 'previous entry not found'; end if;
    set constraints log_entries_log_order_key deferred;
    update public.log_entries set order_index = order_index + 1 where log_id = target_log_id and order_index >= insert_index;
  end if;

  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, content, original_content, raw_html, metadata, is_added, updated_by)
  values (target_log_id, insert_index, new_entry_type, nullif(trim(new_speaker_name), ''), new_content, new_content, new_raw_html, '{"added": true}'::jsonb, true, auth.uid())
  returning * into created_entry;
  return created_entry;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.pending_accounts enable row level security;
alter table public.pages enable row level security;
alter table public.logs enable row level security;
alter table public.log_entries enable row level security;
alter table public.log_entry_revisions enable row level security;
alter table public.log_imports enable row level security;
alter table public.correction_settings enable row level security;
alter table public.publications enable row level security;

create policy "profiles are visible to workspace peers" on public.profiles
for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

create policy "members can view workspaces" on public.workspaces
for select to authenticated using (public.is_workspace_member(id));
create policy "owners can update workspaces" on public.workspaces
for update to authenticated using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

create policy "members can view memberships" on public.workspace_members
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "owners can add memberships" on public.workspace_members
for insert to authenticated with check (public.is_workspace_owner(workspace_id));
create policy "owners can remove memberships" on public.workspace_members
for delete to authenticated using (public.is_workspace_owner(workspace_id) and role <> 'owner');

create policy "owners can view pending accounts" on public.pending_accounts
for select to authenticated using (public.is_workspace_owner(workspace_id));
create policy "owners can create pending accounts" on public.pending_accounts
for insert to authenticated with check (public.is_workspace_owner(workspace_id) and created_by = auth.uid());
create policy "owners can update pending accounts" on public.pending_accounts
for update to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
create policy "owners can remove pending accounts" on public.pending_accounts
for delete to authenticated using (public.is_workspace_owner(workspace_id));

create policy "members can read pages" on public.pages
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members can create pages" on public.pages
for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members can update pages" on public.pages
for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members can delete pages" on public.pages
for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "members can read logs" on public.logs
for select to authenticated using (exists (
  select 1 from public.pages p where p.id = logs.page_id
  and public.is_workspace_member(p.workspace_id)
));
create policy "members can create logs" on public.logs
for insert to authenticated with check (exists (
  select 1 from public.pages p where p.id = logs.page_id and public.is_workspace_member(p.workspace_id)
));
create policy "members can update logs" on public.logs
for update to authenticated using (exists (
  select 1 from public.pages p where p.id = logs.page_id and public.is_workspace_member(p.workspace_id)
));

create policy "members can read entries" on public.log_entries
for select to authenticated using (exists (
  select 1 from public.logs l join public.pages p on p.id = l.page_id
  where l.id = log_entries.log_id
  and public.is_workspace_member(p.workspace_id)
));

create policy "members can read entry revisions" on public.log_entry_revisions
for select to authenticated using (exists (
  select 1 from public.log_entries e join public.logs l on l.id = e.log_id join public.pages p on p.id = l.page_id
  where e.id = log_entry_revisions.entry_id and public.is_workspace_member(p.workspace_id)
));

create policy "members can read log imports" on public.log_imports
for select to authenticated using (exists (
  select 1 from public.logs l join public.pages p on p.id = l.page_id
  where l.id = log_imports.log_id and public.is_workspace_member(p.workspace_id)
));

create policy "members can read correction settings" on public.correction_settings
for select to authenticated using (exists (
  select 1 from public.logs l join public.pages p on p.id = l.page_id
  where l.id = correction_settings.log_id and public.is_workspace_member(p.workspace_id)
));
create policy "members can update correction settings" on public.correction_settings
for update to authenticated using (exists (
  select 1 from public.logs l join public.pages p on p.id = l.page_id
  where l.id = correction_settings.log_id and public.is_workspace_member(p.workspace_id)
)) with check (exists (
  select 1 from public.logs l join public.pages p on p.id = l.page_id
  where l.id = correction_settings.log_id and public.is_workspace_member(p.workspace_id)
));

create policy "members can read publications" on public.publications
for select to authenticated using (exists (
  select 1 from public.pages p where p.id = publications.page_id and public.is_workspace_member(p.workspace_id)
));
create policy "members can create publications" on public.publications
for insert to authenticated with check (exists (
  select 1 from public.pages p where p.id = publications.page_id and public.is_workspace_member(p.workspace_id)
));
create policy "members can update publications" on public.publications
for update to authenticated using (exists (
  select 1 from public.pages p where p.id = publications.page_id and public.is_workspace_member(p.workspace_id)
));

revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.is_workspace_owner(uuid) from public, anon;
revoke execute on function public.replace_log_entries(uuid, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.update_log_entry_content(uuid, uuid, text, text, text, timestamptz) from public, anon;
revoke execute on function public.set_log_entry_deleted(uuid, uuid, boolean) from public, anon;
revoke execute on function public.create_log_entry(uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_log() from public, anon, authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.replace_log_entries(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.update_log_entry_content(uuid, uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.set_log_entry_deleted(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_log_entry(uuid, uuid, text, text, text, text) to authenticated;
