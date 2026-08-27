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
  document_version integer,
  document jsonb,
  original_document jsonb,
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
  previous_snapshot jsonb,
  next_snapshot jsonb,
  revision_schema_version integer,
  created_at timestamptz not null default now()
);

create table if not exists public.log_imports (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  source_html text not null,
  report jsonb not null default '{}'::jsonb,
  parsed_snapshot jsonb,
  replaced_entries_snapshot jsonb,
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

create or replace function public.replace_log_entries_v2(
  target_page_id uuid, source_html text, source_platform text, report jsonb, entries jsonb
)
returns integer language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; declare inserted_count integer; declare replaced_snapshot jsonb;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'entries must be an array'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entry', to_jsonb(e), 'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.log_entry_revisions r where r.entry_id = e.id), '[]'::jsonb)) order by e.order_index), '[]'::jsonb)
  into replaced_snapshot from public.log_entries e where e.log_id = target_log_id;
  insert into public.log_imports(log_id, source_html, report, imported_by, parsed_snapshot, replaced_entries_snapshot)
  values (target_log_id, source_html, report, auth.uid(), entries, replaced_snapshot);
  update public.logs set original_html = source_html, platform = source_platform, import_report = report where id = target_log_id;
  delete from public.log_entries where log_id = target_log_id;
  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, speaker_color, content, original_content, raw_html, metadata, document_version, document, original_document)
  select target_log_id, item.order_index, item.entry_type, item.speaker_name, item.speaker_color, item.content, item.original_content, null,
    coalesce(item.metadata, '{}'::jsonb), 2, item.document, item.original_document
  from jsonb_to_recordset(entries) as item(order_index integer, entry_type text, speaker_name text, speaker_color text, content text, original_content text, metadata jsonb, document jsonb, original_document jsonb)
  where item.document->>'version' = '2' and item.original_document->>'version' = '2';
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(entries) then raise exception 'one or more v2 documents were invalid'; end if;
  return inserted_count;
end;
$$;

create or replace function public.update_log_entry_document_v2(
  target_page_id uuid, target_entry_id uuid, next_document jsonb, next_content text,
  revision_action text default 'edit', expected_updated_at timestamptz default null
)
returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  if next_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id where e.id = target_entry_id and l.page_id = target_page_id and e.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.document_version <> 2 then raise exception 'entry is not v2'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then raise exception using errcode = '40001', message = 'entry was edited by another member'; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), revision_action, target_entry.content, next_content, target_entry.document, next_document, 2);
  update public.log_entries set document = next_document, content = next_content,
    entry_type = case when next_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    speaker_name = nullif(next_document#>>'{speaker,name}', ''), speaker_color = nullif(next_document#>>'{speaker,color}', ''),
    metadata = metadata || '{"edited": true}'::jsonb, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

create or replace function public.create_log_entry_v2(target_page_id uuid, after_entry_id uuid, new_document jsonb, new_content text)
returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; declare insert_index integer; declare created_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  if new_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  if after_entry_id is null then select coalesce(max(order_index), -1) + 1 into insert_index from public.log_entries where log_id = target_log_id;
  else
    select order_index + 1 into insert_index from public.log_entries where id = after_entry_id and log_id = target_log_id;
    if insert_index is null then raise exception 'previous entry not found'; end if;
    set constraints log_entries_log_order_key deferred;
    update public.log_entries set order_index = order_index + 1 where log_id = target_log_id and order_index >= insert_index;
  end if;
  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, speaker_color, content, original_content, raw_html, metadata, is_added, updated_by, document_version, document, original_document)
  values (target_log_id, insert_index, case when new_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    nullif(new_document#>>'{speaker,name}', ''), nullif(new_document#>>'{speaker,color}', ''), new_content, new_content, null,
    '{"added": true, "parserVersion": 2}'::jsonb, true, auth.uid(), 2, new_document, new_document)
  returning * into created_entry;
  return created_entry;
end;
$$;

create or replace function public.set_log_entry_deleted_v2(target_page_id uuid, target_entry_id uuid, should_delete boolean)
returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.is_workspace_member((select workspace_id from public.pages where id = target_page_id)) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id where e.id = target_entry_id and l.page_id = target_page_id for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.is_deleted = should_delete then return target_entry; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), case when should_delete then 'delete' else 'restore' end, target_entry.content, target_entry.content, target_entry.document, target_entry.document, target_entry.document_version);
  update public.log_entries set is_deleted = should_delete, deleted_at = case when should_delete then now() else null end, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
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
revoke execute on function public.replace_log_entries_v2(uuid, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.update_log_entry_document_v2(uuid, uuid, jsonb, text, text, timestamptz) from public, anon;
revoke execute on function public.create_log_entry_v2(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.set_log_entry_deleted_v2(uuid, uuid, boolean) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_log() from public, anon, authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.replace_log_entries(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.update_log_entry_content(uuid, uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.set_log_entry_deleted(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_log_entry(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.replace_log_entries_v2(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.update_log_entry_document_v2(uuid, uuid, jsonb, text, text, timestamptz) to authenticated;
grant execute on function public.create_log_entry_v2(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.set_log_entry_deleted_v2(uuid, uuid, boolean) to authenticated;

-- Current personal-workspace/resource-permission model. This section intentionally
-- follows the legacy-compatible base schema so a new project can bootstrap from this
-- single file, while deployed projects apply the matching additive migration.
-- Personal workspaces, account approval and resource-level collaboration.
-- This migration is additive: legacy workspace_members/pages columns remain for rollback.

alter table public.profiles add column if not exists account_status text;
alter table public.profiles add column if not exists is_site_admin boolean not null default false;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references auth.users(id) on delete set null;

update public.profiles
set account_status = 'approved', approved_at = coalesce(approved_at, created_at)
where account_status is null;

alter table public.profiles alter column account_status set default 'pending';
alter table public.profiles alter column account_status set not null;

do $$ begin
  alter table public.profiles add constraint profiles_account_status_check
    check (account_status in ('pending', 'approved', 'rejected', 'disabled'));
exception when duplicate_object then null;
end $$;

-- A legacy install is unambiguous only when it has one workspace owner.
do $$
declare legacy_owner_count integer;
declare legacy_owner_id uuid;
begin
  if exists (select 1 from public.profiles) and not exists (select 1 from public.profiles where is_site_admin) then
    select count(distinct owner_id) into legacy_owner_count from public.workspaces;
    if legacy_owner_count = 1 then
      select owner_id into legacy_owner_id from public.workspaces limit 1;
    end if;
    if legacy_owner_count = 0 and (select count(*) from public.profiles) = 1 then
      select id into legacy_owner_id from public.profiles limit 1;
    elsif legacy_owner_count <> 1 then
      raise exception 'Cannot choose the initial site administrator: expected exactly one legacy workspace owner, found %.', legacy_owner_count;
    end if;
    update public.profiles
      set is_site_admin = true, account_status = 'approved', approved_at = coalesce(approved_at, now())
    where id = legacy_owner_id;
  end if;
end $$;

create unique index if not exists profiles_one_site_admin_idx
on public.profiles((is_site_admin)) where is_site_admin;

-- Every approved account receives one private workspace. Existing shared workspaces stay
-- owned by their original owner; collaborators receive a new personal workspace below.
insert into public.workspaces(name, owner_id)
select coalesce(nullif(p.display_name, ''), p.username) || '의 워크스페이스', p.id
from public.profiles p
where p.account_status = 'approved'
  and not exists (select 1 from public.workspaces w where w.owner_id = p.id);

do $$
begin
  if exists (select 1 from public.workspaces group by owner_id having count(*) > 1) then
    raise exception 'Cannot enforce one personal workspace per account: duplicate workspace owners require manual resolution.';
  end if;
end $$;

create unique index if not exists workspaces_one_per_owner_idx on public.workspaces(owner_id);

insert into public.workspace_members(workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
on conflict (workspace_id, user_id) do update set role = 'owner';

alter table public.pages add column if not exists original_owner_id uuid references auth.users(id) on delete restrict;
alter table public.pages add column if not exists deleted_at timestamptz;
alter table public.pages add column if not exists purge_after timestamptz;
alter table public.pages add column if not exists deleted_by uuid references auth.users(id) on delete set null;

update public.pages p
set original_owner_id = w.owner_id
from public.workspaces w
where p.workspace_id = w.id and p.original_owner_id is null;

-- Legacy "archived" pages were the old deletion state. Keep them recoverable under the
-- new 30-day owner trash model instead of silently dropping them from both trees.
update public.pages
set deleted_at = coalesce(deleted_at, updated_at, now()),
    purge_after = coalesce(purge_after, coalesce(deleted_at, updated_at, now()) + interval '30 days'),
    deleted_by = coalesce(deleted_by, original_owner_id)
where is_archived and deleted_at is null;

alter table public.pages alter column original_owner_id set not null;

-- parent_id is legacy placement data only after this migration. Deleting a folder must
-- not cascade-delete independently owned resources through that stale hierarchy.
alter table public.pages drop constraint if exists pages_parent_id_fkey;
alter table public.pages add constraint pages_parent_id_fkey
  foreign key (parent_id) references public.pages(id) on delete set null;

create table if not exists public.workspace_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_id uuid not null references public.pages(id) on delete cascade,
  parent_local_resource_id uuid references public.pages(id) on delete set null,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_items_resource_key unique(workspace_id, resource_id),
  constraint workspace_items_not_self_parent check (resource_id <> parent_local_resource_id)
);

create index if not exists workspace_items_tree_idx
on public.workspace_items(workspace_id, parent_local_resource_id, order_index);

create table if not exists public.folder_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.pages(id) on delete cascade,
  child_resource_id uuid not null references public.pages(id) on delete cascade,
  order_index integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint folder_items_child_key unique(child_resource_id),
  constraint folder_items_not_self check (folder_id <> child_resource_id)
);

create index if not exists folder_items_folder_order_idx on public.folder_items(folder_id, order_index);

create table if not exists public.resource_shares (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_level text not null default 'editor' check (access_level = 'editor'),
  can_invite boolean not null default false,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason text
);

create unique index if not exists resource_shares_one_active_idx
on public.resource_shares(resource_id, user_id) where revoked_at is null;
create index if not exists resource_shares_user_active_idx
on public.resource_shares(user_id, resource_id) where revoked_at is null;

create table if not exists public.pending_resource_shares (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.pages(id) on delete cascade,
  username text not null,
  can_invite boolean not null default false,
  granted_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pending_resource_shares_username_normalized check (username = lower(trim(username)))
);

create unique index if not exists pending_resource_shares_one_active_idx
on public.pending_resource_shares(resource_id, username)
where accepted_at is null and revoked_at is null;

create table if not exists public.account_approval_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('approved', 'rejected', 'disabled', 'reenabled')),
  acted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Legacy workspace invitations become pending shares for each legacy root resource;
-- they never grant membership in the owner's workspace.
insert into public.pending_resource_shares(resource_id, username, can_invite, granted_by, expires_at)
select p.id, pa.username, false, w.owner_id, pa.expires_at
from public.pending_accounts pa
join public.workspaces w on w.id = pa.workspace_id
join public.pages p on p.workspace_id = pa.workspace_id and p.parent_id is null
where pa.accepted_at is null and pa.expires_at > now()
on conflict (resource_id, username) where accepted_at is null and revoked_at is null
do update set expires_at = greatest(pending_resource_shares.expires_at, excluded.expires_at);

-- Preserve the legacy folder topology as shared-folder topology.
insert into public.folder_items(folder_id, child_resource_id, order_index, created_by)
select p.parent_id, p.id, p.order_index, p.original_owner_id
from public.pages p
where p.parent_id is not null
on conflict (child_resource_id) do nothing;

-- Every resource keeps a placement in its original owner's private workspace. While a
-- folder edge is active get_workspace_tree prefers the shared hierarchy; if the edge is
-- removed (or an ancestor is trashed), the owner still has a reachable resource.
insert into public.workspace_items(workspace_id, resource_id, order_index)
select owner_workspace.id, p.id, p.order_index
from public.pages p
join public.workspaces owner_workspace on owner_workspace.owner_id = p.original_owner_id
on conflict (workspace_id, resource_id) do nothing;

-- Convert legacy editors into resource-level shares on each legacy root.
insert into public.resource_shares(resource_id, user_id, granted_by)
select p.id, wm.user_id, w.owner_id
from public.pages p
join public.workspaces w on w.id = p.workspace_id
join public.workspace_members wm on wm.workspace_id = w.id and wm.role = 'editor'
where p.parent_id is null and wm.user_id <> p.original_owner_id
  and not exists (
    select 1 from public.resource_shares rs
    where rs.resource_id = p.id and rs.user_id = wm.user_id and rs.revoked_at is null
  );

-- Existing approved accounts may already match a legacy/pending username. Activate
-- those resource invitations during migration instead of waiting for another approval.
insert into public.resource_shares(resource_id, user_id, can_invite, granted_by)
select prs.resource_id, recipient.id, prs.can_invite, prs.granted_by
from public.pending_resource_shares prs
join public.profiles recipient on recipient.username = prs.username
  and recipient.account_status = 'approved'
join public.pages p on p.id = prs.resource_id and p.deleted_at is null
where prs.accepted_at is null and prs.revoked_at is null and prs.expires_at > now()
  and p.original_owner_id <> recipient.id
on conflict (resource_id, user_id) where revoked_at is null do nothing;

update public.pending_resource_shares
set accepted_by = recipient.id, accepted_at = now()
from public.profiles recipient
where pending_resource_shares.username = recipient.username
  and recipient.account_status = 'approved'
  and pending_resource_shares.accepted_at is null
  and pending_resource_shares.revoked_at is null
  and pending_resource_shares.expires_at > now()
  and exists (
    select 1 from public.resource_shares rs
    where rs.resource_id = pending_resource_shares.resource_id
      and rs.user_id = recipient.id and rs.revoked_at is null
  );

insert into public.workspace_items(workspace_id, resource_id, order_index)
select personal.id, rs.resource_id,
  coalesce((select max(wi.order_index) + 1 from public.workspace_items wi where wi.workspace_id = personal.id), 0)
from public.resource_shares rs
join public.workspaces personal on personal.owner_id = rs.user_id
where rs.revoked_at is null
on conflict (workspace_id, resource_id) do nothing;

create or replace function public.is_account_approved(target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = target_user_id and account_status = 'approved'
  );
$$;

create or replace function public.is_site_admin(target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_account_approved(target_user_id) and exists (
    select 1 from public.profiles where id = target_user_id and is_site_admin
  );
$$;

create or replace function public.is_original_resource_owner(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_account_approved(target_user_id) and exists (
    select 1 from public.pages
    where id = target_resource_id and original_owner_id = target_user_id
  );
$$;

create or replace function public.has_direct_resource_share(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_account_approved(target_user_id) and exists (
    select 1 from public.resource_shares
    where resource_id = target_resource_id and user_id = target_user_id and revoked_at is null
  );
$$;

create or replace function public.has_inherited_resource_access(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  with recursive ancestors(resource_id, path) as (
    select fi.folder_id, array[target_resource_id, fi.folder_id]
    from public.folder_items fi
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where fi.child_resource_id = target_resource_id
    union all
    select fi.folder_id, a.path || fi.folder_id
    from ancestors a
    join public.folder_items fi on fi.child_resource_id = a.resource_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where not fi.folder_id = any(a.path)
  )
  select public.is_account_approved(target_user_id) and exists (
    select 1 from ancestors a
    join public.pages p on p.id = a.resource_id and p.deleted_at is null
    where p.original_owner_id = target_user_id
       or exists (
         select 1 from public.resource_shares rs
         where rs.resource_id = a.resource_id and rs.user_id = target_user_id and rs.revoked_at is null
       )
  );
$$;

create or replace function public.can_view_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_account_approved(target_user_id)
    and exists (select 1 from public.pages where id = target_resource_id and deleted_at is null)
    and (
      public.is_original_resource_owner(target_resource_id, target_user_id)
      or public.has_direct_resource_share(target_resource_id, target_user_id)
      or public.has_inherited_resource_access(target_resource_id, target_user_id)
    );
$$;

create or replace function public.can_edit_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_resource(target_resource_id, target_user_id);
$$;

create or replace function public.can_invite_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, s.path || fi.folder_id
    from scope s
    join public.folder_items fi on fi.child_resource_id = s.resource_id
    join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
    where not fi.folder_id = any(s.path)
  )
  select public.is_account_approved(target_user_id) and exists (
    select 1 from scope s
    join public.pages p on p.id = s.resource_id and p.deleted_at is null
    where p.original_owner_id = target_user_id
       or exists (
         select 1 from public.resource_shares rs
         where rs.resource_id = s.resource_id and rs.user_id = target_user_id
           and rs.revoked_at is null and rs.can_invite
       )
  );
$$;

create or replace function public.can_manage_resource_shares(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_original_resource_owner(target_resource_id, target_user_id)
    and exists (select 1 from public.pages where id = target_resource_id and deleted_at is null);
$$;

create or replace function public.can_delete_resource(target_resource_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_resource_shares(target_resource_id, target_user_id);
$$;

create or replace function public.personal_workspace_id(target_user_id uuid default auth.uid())
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.workspaces where owner_id = target_user_id limit 1;
$$;

create or replace function public.touch_resource_audience(target_resource_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, scope.path || fi.folder_id
    from scope join public.folder_items fi on fi.child_resource_id = scope.resource_id
    where not fi.folder_id = any(scope.path)
  )
  update public.resource_shares
  set updated_at = now()
  where revoked_at is null and resource_id in (select resource_id from scope);
  with recursive scope(resource_id, path) as (
    select target_resource_id, array[target_resource_id]
    union all
    select fi.folder_id, scope.path || fi.folder_id
    from scope join public.folder_items fi on fi.child_resource_id = scope.resource_id
    where not fi.folder_id = any(scope.path)
  )
  update public.pages
  set updated_at = now()
  where deleted_at is null and id in (select resource_id from scope);
end;
$$;

create or replace function public.get_resource_permissions(target_resource_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'canView', public.can_view_resource(target_resource_id, auth.uid()),
    'canEdit', public.can_edit_resource(target_resource_id, auth.uid()),
    'canInvite', public.can_invite_resource(target_resource_id, auth.uid()),
    'canManage', public.can_manage_resource_shares(target_resource_id, auth.uid()),
    'isOriginalOwner', public.is_original_resource_owner(target_resource_id, auth.uid()),
    'canSelfRemove', public.has_direct_resource_share(target_resource_id, auth.uid())
  );
$$;

create or replace function public.assert_no_folder_cycle(target_folder_id uuid, target_child_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if target_folder_id = target_child_id then raise exception 'folder cycle'; end if;
  if exists (
    with recursive descendants(resource_id, path) as (
      select fi.child_resource_id, array[target_child_id, fi.child_resource_id]
      from public.folder_items fi where fi.folder_id = target_child_id
      union all
      select fi.child_resource_id, d.path || fi.child_resource_id
      from descendants d join public.folder_items fi on fi.folder_id = d.resource_id
      where not fi.child_resource_id = any(d.path)
    ) select 1 from descendants where resource_id = target_folder_id
  ) then raise exception 'folder cycle'; end if;
end;
$$;

create or replace function public.get_workspace_tree(target_workspace_id uuid)
returns table(
  id uuid, workspace_id uuid, legacy_parent_id uuid, page_type text, title text, icon text,
  order_index integer, is_archived boolean, original_owner_id uuid, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, tree_parent_id uuid, tree_depth integer,
  tree_relation text, is_original_owner boolean, can_invite boolean, can_self_remove boolean
) language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select wi.resource_id,
      case
        when wi.parent_local_resource_id is null then null
        when exists (
          select 1 from public.pages local_parent
          where local_parent.id = wi.parent_local_resource_id
            and local_parent.page_type = 'folder' and local_parent.deleted_at is null
            and public.can_view_resource(local_parent.id, auth.uid())
        ) then wi.parent_local_resource_id
        else null
      end as tree_parent_id,
      wi.order_index as tree_order, 0 as depth, array[wi.resource_id] as path,
      'workspace'::text as relation
    from public.workspace_items wi
    join public.workspaces w on w.id = wi.workspace_id
    join public.pages mounted on mounted.id = wi.resource_id and mounted.deleted_at is null
    where wi.workspace_id = target_workspace_id and w.owner_id = auth.uid()
    union all
    select fi.child_resource_id, fi.folder_id, fi.order_index, tree.depth + 1,
      tree.path || fi.child_resource_id, 'folder'::text
    from tree
    join public.pages current_folder on current_folder.id = tree.resource_id
      and current_folder.page_type = 'folder' and current_folder.deleted_at is null
    join public.folder_items fi on fi.folder_id = tree.resource_id
    join public.pages child on child.id = fi.child_resource_id and child.deleted_at is null
    where not fi.child_resource_id = any(tree.path)
  ), preferred as (
    select distinct on (tree.resource_id) tree.*
    from tree
    order by tree.resource_id, tree.depth desc
  )
  select p.id, p.workspace_id, p.parent_id, p.page_type, p.title, p.icon,
    preferred.tree_order, p.is_archived, p.original_owner_id, p.deleted_at,
    p.created_at, p.updated_at, preferred.tree_parent_id, preferred.depth, preferred.relation,
    p.original_owner_id = auth.uid(), public.can_invite_resource(p.id, auth.uid()),
    public.has_direct_resource_share(p.id, auth.uid())
  from preferred join public.pages p on p.id = preferred.resource_id
  where public.is_account_approved(auth.uid()) and p.deleted_at is null
    and not p.is_archived and public.can_view_resource(p.id, auth.uid())
  order by preferred.depth, preferred.tree_order, p.created_at;
$$;

create or replace function public.create_resource(
  resource_type text,
  resource_title text default null,
  target_folder_id uuid default null
) returns public.pages language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
declare actor_workspace_id uuid;
declare created_resource public.pages;
declare next_order integer;
begin
  if not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if resource_type not in ('folder', 'log') then raise exception 'invalid resource type'; end if;
  select public.personal_workspace_id(actor_id) into actor_workspace_id;
  if actor_workspace_id is null then raise exception 'personal workspace not found'; end if;
  if target_folder_id is not null then
    if not public.can_edit_resource(target_folder_id, actor_id)
      or not exists (select 1 from public.pages where id = target_folder_id and page_type = 'folder' and deleted_at is null)
    then raise exception 'folder permission denied'; end if;
  end if;

  insert into public.pages(workspace_id, parent_id, page_type, title, created_by, original_owner_id)
  values (
    actor_workspace_id, null, resource_type,
    coalesce(nullif(trim(resource_title), ''), case when resource_type = 'log' then '제목 없는 로그' else '새 폴더' end),
    actor_id, actor_id
  ) returning * into created_resource;
  if resource_type = 'log' then insert into public.logs(page_id) values (created_resource.id); end if;

  select coalesce(max(order_index) + 1, 0) into next_order
  from public.workspace_items where workspace_id = actor_workspace_id and parent_local_resource_id is null;
  insert into public.workspace_items(workspace_id, resource_id, order_index)
  values (actor_workspace_id, created_resource.id, next_order);

  if target_folder_id is not null then
    select coalesce(max(order_index) + 1, 0) into next_order from public.folder_items where folder_id = target_folder_id;
    insert into public.folder_items(folder_id, child_resource_id, order_index, created_by)
    values (target_folder_id, created_resource.id, next_order, actor_id);
    perform public.touch_resource_audience(target_folder_id);
  end if;
  return created_resource;
end;
$$;

create or replace function public.update_resource_title(target_resource_id uuid, next_title text)
returns public.pages language plpgsql security definer set search_path = public as $$
declare updated_resource public.pages;
begin
  if not public.can_edit_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  if nullif(trim(next_title), '') is null then raise exception 'title is required'; end if;
  update public.pages set title = left(trim(next_title), 200)
  where id = target_resource_id and deleted_at is null returning * into updated_resource;
  if updated_resource.id is null then raise exception 'resource not found'; end if;
  return updated_resource;
end;
$$;

create or replace function public.move_workspace_item(target_resource_id uuid, target_parent_local_resource_id uuid default null, target_order integer default 0)
returns public.workspace_items language plpgsql security definer set search_path = public as $$
declare actor_workspace_id uuid;
declare moved_item public.workspace_items;
begin
  if not public.can_view_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  actor_workspace_id := public.personal_workspace_id(auth.uid());
  if actor_workspace_id is null then raise exception 'personal workspace not found'; end if;
  if target_parent_local_resource_id is not null then
    if target_parent_local_resource_id = target_resource_id
      or not public.can_view_resource(target_parent_local_resource_id, auth.uid())
      or not exists (select 1 from public.pages where id = target_parent_local_resource_id and page_type = 'folder' and deleted_at is null)
    then raise exception 'invalid local parent'; end if;
    if exists (
      with recursive edges(parent_id, child_id) as (
        select fi.folder_id, fi.child_resource_id from public.folder_items fi
        union
        select wi.parent_local_resource_id, wi.resource_id
        from public.workspace_items wi
        where wi.workspace_id = actor_workspace_id and wi.parent_local_resource_id is not null
      ), descendants(resource_id, path) as (
        select e.child_id, array[target_resource_id, e.child_id]
        from edges e where e.parent_id = target_resource_id
        union all
        select e.child_id, d.path || e.child_id
        from descendants d join edges e on e.parent_id = d.resource_id
        where not e.child_id = any(d.path)
      )
      select 1 from descendants where resource_id = target_parent_local_resource_id
    ) then raise exception 'workspace placement cycle'; end if;
  end if;
  insert into public.workspace_items(workspace_id, resource_id, parent_local_resource_id, order_index)
  values (actor_workspace_id, target_resource_id, target_parent_local_resource_id, greatest(target_order, 0))
  on conflict (workspace_id, resource_id) do update
    set parent_local_resource_id = excluded.parent_local_resource_id,
        order_index = excluded.order_index,
        updated_at = now()
  returning * into moved_item;
  return moved_item;
end;
$$;

create or replace function public.insert_folder_item(target_folder_id uuid, target_child_resource_id uuid, target_order integer default 0)
returns public.folder_items language plpgsql security definer set search_path = public as $$
declare created_item public.folder_items;
declare existing_folder_id uuid;
begin
  if not public.can_edit_resource(target_folder_id, auth.uid())
    or not public.can_view_resource(target_child_resource_id, auth.uid())
  then raise exception 'permission denied'; end if;
  if not exists (select 1 from public.pages where id = target_folder_id and page_type = 'folder' and deleted_at is null)
  then raise exception 'folder not found'; end if;
  perform public.assert_no_folder_cycle(target_folder_id, target_child_resource_id);

  select folder_id into existing_folder_id
  from public.folder_items where child_resource_id = target_child_resource_id;

  -- A first insertion into the shared hierarchy is a re-share, even when the target
  -- folder currently has no collaborators. Personal-only organization must use
  -- workspace_items, otherwise a collaborator could launder invite permission by
  -- inserting a foreign page into a private folder and sharing that folder later.
  if not public.can_invite_resource(target_child_resource_id, auth.uid()) then
    if existing_folder_id is null then raise exception 'reshare permission required'; end if;

    -- Editors may still reorder/move a child inside the same shared tree when that move
    -- introduces no new viewer. Moving it into an unrelated tree requires invite rights.
    if not exists (
      with recursive source_scope(resource_id, path) as (
        select existing_folder_id, array[existing_folder_id]
        union all
        select fi.folder_id, s.path || fi.folder_id
        from source_scope s
        join public.folder_items fi on fi.child_resource_id = s.resource_id
        join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
        where not fi.folder_id = any(s.path)
      ), target_scope(resource_id, path) as (
        select target_folder_id, array[target_folder_id]
        union all
        select fi.folder_id, s.path || fi.folder_id
        from target_scope s
        join public.folder_items fi on fi.child_resource_id = s.resource_id
        join public.pages parent on parent.id = fi.folder_id and parent.deleted_at is null
        where not fi.folder_id = any(s.path)
      )
      select 1 from source_scope source
      join target_scope target on target.resource_id = source.resource_id
    ) or exists (
      select 1 from public.profiles audience
      where audience.account_status = 'approved'
        and public.can_view_resource(target_folder_id, audience.id)
        and not public.can_view_resource(target_child_resource_id, audience.id)
    ) then raise exception 'reshare permission required'; end if;
  end if;

  insert into public.folder_items(folder_id, child_resource_id, order_index, created_by)
  values (target_folder_id, target_child_resource_id, greatest(target_order, 0), auth.uid())
  on conflict (child_resource_id) do update
    set folder_id = excluded.folder_id, order_index = excluded.order_index, updated_at = now()
  returning * into created_item;
  if existing_folder_id is not null and existing_folder_id <> target_folder_id then
    perform public.touch_resource_audience(existing_folder_id);
  end if;
  perform public.touch_resource_audience(target_folder_id);
  return created_item;
end;
$$;

create or replace function public.remove_folder_item(target_folder_id uuid, target_child_resource_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare removed boolean;
declare owner_workspace_id uuid;
declare next_order integer;
begin
  if not public.can_edit_resource(target_folder_id, auth.uid()) then raise exception 'permission denied'; end if;
  delete from public.folder_items where folder_id = target_folder_id and child_resource_id = target_child_resource_id;
  removed := found;
  if removed then
    perform public.touch_resource_audience(target_folder_id);
    select w.id into owner_workspace_id
    from public.pages p join public.workspaces w on w.owner_id = p.original_owner_id
    where p.id = target_child_resource_id;
    if owner_workspace_id is not null then
      select coalesce(max(order_index) + 1, 0) into next_order
      from public.workspace_items
      where workspace_id = owner_workspace_id and parent_local_resource_id is null;
      insert into public.workspace_items(workspace_id, resource_id, order_index)
      values (owner_workspace_id, target_child_resource_id, next_order)
      on conflict (workspace_id, resource_id) do nothing;
    end if;
  end if;
  return removed;
end;
$$;

create or replace function public.share_resource(target_resource_id uuid, target_username text, grant_can_invite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare normalized_username text := lower(trim(target_username));
declare recipient public.profiles;
declare recipient_workspace_id uuid;
declare created_share_id uuid;
begin
  if not public.can_invite_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  if grant_can_invite and not public.is_original_resource_owner(target_resource_id, auth.uid())
  then raise exception 'only the original owner can delegate invite permission'; end if;
  if char_length(normalized_username) not between 2 and 40
    or normalized_username !~ '^[[:alnum:]가-힣._-]+$'
  then raise exception 'invalid username'; end if;
  select * into recipient from public.profiles where username = normalized_username;
  if recipient.id = auth.uid() then raise exception 'cannot share with yourself'; end if;

  if recipient.id is not null and recipient.account_status = 'approved' then
    if public.is_original_resource_owner(target_resource_id, recipient.id) then raise exception 'user is the original owner'; end if;
    select id into created_share_id from public.resource_shares
    where resource_id = target_resource_id and user_id = recipient.id and revoked_at is null;
    if created_share_id is not null then
      if grant_can_invite then
        update public.resource_shares set can_invite = true where id = created_share_id;
      end if;
      recipient_workspace_id := public.personal_workspace_id(recipient.id);
      insert into public.workspace_items(workspace_id, resource_id, order_index)
      select recipient_workspace_id, target_resource_id, coalesce(max(order_index) + 1, 0)
      from public.workspace_items where workspace_id = recipient_workspace_id
      on conflict (workspace_id, resource_id) do nothing;
      return jsonb_build_object('state', 'active', 'shareId', created_share_id,
        'username', normalized_username, 'alreadyShared', true);
    end if;
    insert into public.resource_shares(resource_id, user_id, can_invite, granted_by)
    values (target_resource_id, recipient.id, grant_can_invite, auth.uid())
    returning id into created_share_id;
    recipient_workspace_id := public.personal_workspace_id(recipient.id);
    insert into public.workspace_items(workspace_id, resource_id, order_index)
    select recipient_workspace_id, target_resource_id, coalesce(max(order_index) + 1, 0)
    from public.workspace_items where workspace_id = recipient_workspace_id
    on conflict (workspace_id, resource_id) do nothing;
    return jsonb_build_object('state', 'active', 'shareId', created_share_id, 'username', normalized_username);
  end if;

  insert into public.pending_resource_shares(resource_id, username, can_invite, granted_by)
  values (target_resource_id, normalized_username, grant_can_invite, auth.uid())
  on conflict (resource_id, username) where accepted_at is null and revoked_at is null
  do update set can_invite = excluded.can_invite, granted_by = excluded.granted_by,
    expires_at = now() + interval '30 days'
  returning id into created_share_id;
  return jsonb_build_object('state', 'pending', 'shareId', created_share_id, 'username', normalized_username);
end;
$$;

create or replace function public.list_resource_shares(target_resource_id uuid)
returns table(
  share_id uuid, user_id uuid, username text, display_name text, can_invite boolean,
  granted_by uuid, created_at timestamptz, state text
) language sql stable security definer set search_path = public as $$
  select rs.id, rs.user_id, p.username, p.display_name, rs.can_invite,
    rs.granted_by, rs.created_at, 'active'::text
  from public.resource_shares rs join public.profiles p on p.id = rs.user_id
  where rs.resource_id = target_resource_id and rs.revoked_at is null
    and public.can_manage_resource_shares(target_resource_id, auth.uid())
  union all
  select prs.id, null::uuid, prs.username, null::text, prs.can_invite,
    prs.granted_by, prs.created_at, 'pending'::text
  from public.pending_resource_shares prs
  where prs.resource_id = target_resource_id and prs.accepted_at is null and prs.revoked_at is null
    and prs.expires_at > now() and public.can_manage_resource_shares(target_resource_id, auth.uid())
  order by created_at;
$$;

create or replace function public.set_resource_share_invite(target_share_id uuid, next_can_invite boolean)
returns public.resource_shares language plpgsql security definer set search_path = public as $$
declare target_share public.resource_shares;
begin
  select * into target_share from public.resource_shares where id = target_share_id and revoked_at is null for update;
  if target_share.id is null or not public.can_manage_resource_shares(target_share.resource_id, auth.uid())
  then raise exception 'permission denied'; end if;
  update public.resource_shares set can_invite = next_can_invite
  where id = target_share_id returning * into target_share;
  return target_share;
end;
$$;

create or replace function public.revoke_resource_share(target_share_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare target_share public.resource_shares;
begin
  select * into target_share from public.resource_shares where id = target_share_id and revoked_at is null for update;
  if target_share.id is null or not public.can_manage_resource_shares(target_share.resource_id, auth.uid())
  then raise exception 'permission denied'; end if;
  update public.resource_shares set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = 'owner_revoke'
  where id = target_share_id;
  delete from public.workspace_items
  where workspace_id = public.personal_workspace_id(target_share.user_id) and resource_id = target_share.resource_id;
  return true;
end;
$$;

create or replace function public.revoke_pending_resource_share(target_pending_share_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare target_share public.pending_resource_shares;
begin
  select * into target_share from public.pending_resource_shares where id = target_pending_share_id and revoked_at is null for update;
  if target_share.id is null or not public.can_manage_resource_shares(target_share.resource_id, auth.uid())
  then raise exception 'permission denied'; end if;
  update public.pending_resource_shares set revoked_at = now() where id = target_pending_share_id;
  return true;
end;
$$;

create or replace function public.self_remove_resource(target_resource_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
begin
  if not public.is_account_approved(actor_id) or public.is_original_resource_owner(target_resource_id, actor_id)
  then raise exception 'resource owner cannot self-remove'; end if;
  if not public.has_direct_resource_share(target_resource_id, actor_id) then
    raise exception 'direct share not found';
  end if;
  update public.resource_shares set revoked_at = now(), revoked_by = actor_id, revocation_reason = 'self_remove'
  where resource_id = target_resource_id and user_id = actor_id and revoked_at is null;
  delete from public.workspace_items
  where workspace_id = public.personal_workspace_id(actor_id) and resource_id = target_resource_id;
  return true;
end;
$$;

create or replace function public.trash_resource(target_resource_id uuid)
returns public.pages language plpgsql security definer set search_path = public as $$
declare trashed public.pages;
begin
  if not public.can_delete_resource(target_resource_id, auth.uid()) then raise exception 'permission denied'; end if;
  update public.pages set deleted_at = now(), purge_after = now() + interval '30 days',
    deleted_by = auth.uid(), is_archived = true
  where id = target_resource_id and deleted_at is null returning * into trashed;
  if trashed.id is null then raise exception 'resource not found'; end if;
  update public.publications set is_active = false where page_id = target_resource_id;
  perform public.touch_resource_audience(target_resource_id);
  return trashed;
end;
$$;

create or replace function public.restore_resource(target_resource_id uuid)
returns public.pages language plpgsql security definer set search_path = public as $$
declare restored public.pages;
begin
  if not public.is_account_approved(auth.uid()) or not exists (
    select 1 from public.pages where id = target_resource_id and original_owner_id = auth.uid() and deleted_at is not null
  ) then raise exception 'permission denied'; end if;
  update public.pages set deleted_at = null, purge_after = null, deleted_by = null, is_archived = false
  where id = target_resource_id returning * into restored;
  perform public.touch_resource_audience(target_resource_id);
  return restored;
end;
$$;

create or replace function public.permanently_delete_resource(target_resource_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_account_approved(auth.uid()) or not exists (
    select 1 from public.pages where id = target_resource_id and original_owner_id = auth.uid() and deleted_at is not null
  ) then raise exception 'permission denied'; end if;
  delete from public.pages where id = target_resource_id;
  return found;
end;
$$;

create or replace function public.purge_expired_resources()
returns integer language plpgsql security definer set search_path = public as $$
declare purged integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'permission denied'; end if;
  delete from public.pages where deleted_at is not null and purge_after <= now();
  get diagnostics purged = row_count;
  return purged;
end;
$$;

-- Recreate the auth trigger: first account is approved admin; later accounts wait for approval.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_account boolean;
declare new_workspace_id uuid;
declare resolved_username text;
begin
  perform pg_advisory_xact_lock(hashtext('logcontainer:first-account'));
  resolved_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if resolved_username = '' then raise exception 'username is required'; end if;
  select not exists(select 1 from public.profiles) into first_account;
  insert into public.profiles(id, username, display_name, account_status, is_site_admin, approved_at)
  values (
    new.id,
    resolved_username,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), resolved_username),
    case when first_account then 'approved' else 'pending' end,
    first_account,
    case when first_account then now() else null end
  );
  if first_account then
    insert into public.workspaces(name, owner_id)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), resolved_username) || '의 워크스페이스', new.id)
    returning id into new_workspace_id;
    insert into public.workspace_members(workspace_id, user_id, role)
    values (new_workspace_id, new.id, 'owner') on conflict do nothing;
  end if;
  return new;
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
  on conflict (owner_id) do update set owner_id = excluded.owner_id
  returning id into target_workspace_id;
  insert into public.workspace_members(workspace_id, user_id, role)
  values (target_workspace_id, target_user_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';

  insert into public.resource_shares(resource_id, user_id, can_invite, granted_by)
  select prs.resource_id, target_user_id, prs.can_invite, prs.granted_by
  from public.pending_resource_shares prs
  join public.pages p on p.id = prs.resource_id and p.deleted_at is null
  where prs.username = target_profile.username and prs.accepted_at is null
    and prs.revoked_at is null and prs.expires_at > now()
    and not exists (
      select 1 from public.resource_shares rs
      where rs.resource_id = prs.resource_id and rs.user_id = target_user_id and rs.revoked_at is null
    );
  update public.pending_resource_shares
  set accepted_by = target_user_id, accepted_at = now()
  where username = target_profile.username and accepted_at is null and revoked_at is null and expires_at > now()
    and exists (
      select 1 from public.resource_shares rs
      join public.pages p on p.id = rs.resource_id and p.deleted_at is null
      where rs.resource_id = pending_resource_shares.resource_id
        and rs.user_id = target_user_id and rs.revoked_at is null
    );
  insert into public.workspace_items(workspace_id, resource_id, order_index)
  select target_workspace_id, rs.resource_id,
    row_number() over(order by rs.created_at)::integer - 1
  from public.resource_shares rs
  where rs.user_id = target_user_id and rs.revoked_at is null
  on conflict (workspace_id, resource_id) do nothing;

  insert into public.account_approval_events(user_id, action, acted_by)
  values (target_user_id, case when prior_status = 'approved' then 'reenabled' else 'approved' end, actor_id);
  return target_profile;
end;
$$;

-- Log writes keep their audited/revision behavior, but permission is now checked on the
-- concrete page resource at save time (including after a share has been revoked).
create or replace function public.replace_log_entries(
  target_page_id uuid, source_html text, source_platform text, report jsonb, entries jsonb
) returns integer language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; declare inserted_count integer;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  insert into public.log_imports(log_id, source_html, report, imported_by) values (target_log_id, source_html, report, auth.uid());
  update public.logs set original_html = source_html, platform = source_platform, import_report = report where id = target_log_id;
  delete from public.log_entries where log_id = target_log_id;
  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, speaker_color, content, original_content, raw_html, metadata)
  select target_log_id, item.order_index, item.entry_type, item.speaker_name, item.speaker_color,
    item.content, item.original_content, item.raw_html, coalesce(item.metadata, '{}'::jsonb)
  from jsonb_to_recordset(entries) as item(order_index integer, entry_type text, speaker_name text,
    speaker_color text, content text, original_content text, raw_html text, metadata jsonb);
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.update_log_entry_content(
  target_page_id uuid, target_entry_id uuid, next_content text, next_raw_html text,
  revision_action text default 'edit', expected_updated_at timestamptz default null
) returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
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

create or replace function public.set_log_entry_deleted(target_page_id uuid, target_entry_id uuid, should_delete boolean)
returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
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
  target_page_id uuid, after_entry_id uuid, new_entry_type text, new_speaker_name text,
  new_content text, new_raw_html text
) returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; declare insert_index integer; declare created_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
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
  values (target_log_id, insert_index, new_entry_type, nullif(trim(new_speaker_name), ''), new_content, new_content,
    new_raw_html, '{"added": true}'::jsonb, true, auth.uid()) returning * into created_entry;
  return created_entry;
end;
$$;

create or replace function public.replace_log_entries_v2(
  target_page_id uuid, source_html text, source_platform text, report jsonb, entries jsonb
) returns integer language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; declare inserted_count integer; declare replaced_snapshot jsonb;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select id into target_log_id from public.logs where page_id = target_page_id;
  if target_log_id is null then raise exception 'log not found'; end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'entries must be an array'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entry', to_jsonb(e), 'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.log_entry_revisions r where r.entry_id = e.id), '[]'::jsonb)) order by e.order_index), '[]'::jsonb)
  into replaced_snapshot from public.log_entries e where e.log_id = target_log_id;
  insert into public.log_imports(log_id, source_html, report, imported_by, parsed_snapshot, replaced_entries_snapshot)
  values (target_log_id, source_html, report, auth.uid(), entries, replaced_snapshot);
  update public.logs set original_html = source_html, platform = source_platform, import_report = report where id = target_log_id;
  delete from public.log_entries where log_id = target_log_id;
  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, speaker_color, content, original_content, raw_html, metadata, document_version, document, original_document)
  select target_log_id, item.order_index, item.entry_type, item.speaker_name, item.speaker_color,
    item.content, item.original_content, null, coalesce(item.metadata, '{}'::jsonb), 2, item.document, item.original_document
  from jsonb_to_recordset(entries) as item(order_index integer, entry_type text, speaker_name text,
    speaker_color text, content text, original_content text, metadata jsonb, document jsonb, original_document jsonb)
  where item.document->>'version' = '2' and item.original_document->>'version' = '2';
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(entries) then raise exception 'one or more v2 documents were invalid'; end if;
  return inserted_count;
end;
$$;

create or replace function public.update_log_entry_document_v2(
  target_page_id uuid, target_entry_id uuid, next_document jsonb, next_content text,
  revision_action text default 'edit', expected_updated_at timestamptz default null
) returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if next_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id and e.is_deleted = false for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.document_version <> 2 then raise exception 'entry is not v2'; end if;
  if expected_updated_at is not null and target_entry.updated_at <> expected_updated_at then
    raise exception using errcode = '40001', message = 'entry was edited by another member'; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content,
    previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), revision_action, target_entry.content, next_content,
    target_entry.document, next_document, 2);
  update public.log_entries set document = next_document, content = next_content,
    entry_type = case when next_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    speaker_name = nullif(next_document#>>'{speaker,name}', ''), speaker_color = nullif(next_document#>>'{speaker,color}', ''),
    metadata = metadata || '{"edited": true}'::jsonb, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

create or replace function public.create_log_entry_v2(target_page_id uuid, after_entry_id uuid, new_document jsonb, new_content text)
returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_log_id uuid; declare insert_index integer; declare created_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  if new_document->>'version' <> '2' then raise exception 'invalid v2 document'; end if;
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
  insert into public.log_entries(log_id, order_index, entry_type, speaker_name, speaker_color, content,
    original_content, raw_html, metadata, is_added, updated_by, document_version, document, original_document)
  values (target_log_id, insert_index, case when new_document->>'kind' = 'dialogue' then 'dialogue' else 'system' end,
    nullif(new_document#>>'{speaker,name}', ''), nullif(new_document#>>'{speaker,color}', ''), new_content, new_content,
    null, '{"added": true, "parserVersion": 2}'::jsonb, true, auth.uid(), 2, new_document, new_document)
  returning * into created_entry;
  return created_entry;
end;
$$;

create or replace function public.set_log_entry_deleted_v2(target_page_id uuid, target_entry_id uuid, should_delete boolean)
returns public.log_entries language plpgsql security definer set search_path = public as $$
declare target_entry public.log_entries;
begin
  if not public.can_edit_resource(target_page_id, auth.uid()) then raise exception 'permission denied'; end if;
  select e.* into target_entry from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = target_entry_id and l.page_id = target_page_id for update;
  if target_entry.id is null then raise exception 'entry not found'; end if;
  if target_entry.is_deleted = should_delete then return target_entry; end if;
  insert into public.log_entry_revisions(entry_id, editor_id, action, previous_content, next_content,
    previous_snapshot, next_snapshot, revision_schema_version)
  values (target_entry.id, auth.uid(), case when should_delete then 'delete' else 'restore' end,
    target_entry.content, target_entry.content, target_entry.document, target_entry.document, target_entry.document_version);
  update public.log_entries set is_deleted = should_delete,
    deleted_at = case when should_delete then now() else null end, updated_by = auth.uid()
  where id = target_entry.id returning * into target_entry;
  return target_entry;
end;
$$;

alter table public.workspace_items enable row level security;
alter table public.folder_items enable row level security;
alter table public.resource_shares enable row level security;
alter table public.pending_resource_shares enable row level security;
alter table public.account_approval_events enable row level security;

drop policy if exists "profiles are visible to workspace peers" on public.profiles;
drop policy if exists "members can view workspaces" on public.workspaces;
drop policy if exists "owners can update workspaces" on public.workspaces;
drop policy if exists "members can view memberships" on public.workspace_members;
drop policy if exists "owners can add memberships" on public.workspace_members;
drop policy if exists "owners can remove memberships" on public.workspace_members;
drop policy if exists "owners can view pending accounts" on public.pending_accounts;
drop policy if exists "owners can create pending accounts" on public.pending_accounts;
drop policy if exists "owners can update pending accounts" on public.pending_accounts;
drop policy if exists "owners can remove pending accounts" on public.pending_accounts;
drop policy if exists "members can read pages" on public.pages;
drop policy if exists "members can create pages" on public.pages;
drop policy if exists "members can update pages" on public.pages;
drop policy if exists "members can delete pages" on public.pages;
drop policy if exists "members can read logs" on public.logs;
drop policy if exists "members can create logs" on public.logs;
drop policy if exists "members can update logs" on public.logs;
drop policy if exists "members can read entries" on public.log_entries;
drop policy if exists "members can read entry revisions" on public.log_entry_revisions;
drop policy if exists "members can read log imports" on public.log_imports;
drop policy if exists "members can read correction settings" on public.correction_settings;
drop policy if exists "members can update correction settings" on public.correction_settings;
drop policy if exists "members can read publications" on public.publications;
drop policy if exists "members can create publications" on public.publications;
drop policy if exists "members can update publications" on public.publications;

create policy "approved users see their profile and collaborators" on public.profiles
for select to authenticated using (
  public.is_account_approved(auth.uid()) and (
    id = auth.uid()
    or public.is_site_admin(auth.uid())
    or exists (
      select 1 from public.resource_shares mine
      join public.resource_shares theirs on theirs.resource_id = mine.resource_id
      where mine.user_id = auth.uid() and mine.revoked_at is null
        and theirs.user_id = profiles.id and theirs.revoked_at is null
    )
  )
);

create policy "approved owners see personal workspaces" on public.workspaces
for select to authenticated using (owner_id = auth.uid() and public.is_account_approved(auth.uid()));
create policy "approved owners update personal workspaces" on public.workspaces
for update to authenticated using (owner_id = auth.uid() and public.is_account_approved(auth.uid()))
with check (owner_id = auth.uid() and public.is_account_approved(auth.uid()));

create policy "legacy memberships are self visible" on public.workspace_members
for select to authenticated using (user_id = auth.uid() and public.is_account_approved(auth.uid()));

create policy "approved users read accessible resources" on public.pages
for select to authenticated using (
  public.can_view_resource(id, auth.uid())
  or (original_owner_id = auth.uid() and deleted_at is not null and public.is_account_approved(auth.uid()))
);

create policy "approved users read accessible logs" on public.logs
for select to authenticated using (exists (
  select 1 from public.pages p where p.id = logs.page_id and public.can_view_resource(p.id, auth.uid())
));

create policy "approved users read accessible entries" on public.log_entries
for select to authenticated using (exists (
  select 1 from public.logs l where l.id = log_entries.log_id and public.can_view_resource(l.page_id, auth.uid())
));

create policy "approved users read accessible revisions" on public.log_entry_revisions
for select to authenticated using (exists (
  select 1 from public.log_entries e join public.logs l on l.id = e.log_id
  where e.id = log_entry_revisions.entry_id and public.can_view_resource(l.page_id, auth.uid())
));

create policy "approved users read accessible imports" on public.log_imports
for select to authenticated using (exists (
  select 1 from public.logs l where l.id = log_imports.log_id and public.can_view_resource(l.page_id, auth.uid())
));

create policy "approved users read accessible corrections" on public.correction_settings
for select to authenticated using (exists (
  select 1 from public.logs l where l.id = correction_settings.log_id and public.can_view_resource(l.page_id, auth.uid())
));
create policy "editors update accessible corrections" on public.correction_settings
for update to authenticated using (exists (
  select 1 from public.logs l where l.id = correction_settings.log_id and public.can_edit_resource(l.page_id, auth.uid())
)) with check (exists (
  select 1 from public.logs l where l.id = correction_settings.log_id and public.can_edit_resource(l.page_id, auth.uid())
));

create policy "owners read resource publications" on public.publications
for select to authenticated using (public.can_view_resource(page_id, auth.uid()));
create policy "owners create resource publications" on public.publications
for insert to authenticated with check (public.can_manage_resource_shares(page_id, auth.uid()));
create policy "owners update resource publications" on public.publications
for update to authenticated using (public.can_manage_resource_shares(page_id, auth.uid()))
with check (public.can_manage_resource_shares(page_id, auth.uid()));

create policy "owners manage private placement" on public.workspace_items
for select to authenticated using (
  workspace_id = public.personal_workspace_id(auth.uid()) and public.is_account_approved(auth.uid())
);

create policy "users read accessible folder edges" on public.folder_items
for select to authenticated using (
  public.can_view_resource(folder_id, auth.uid()) and public.can_view_resource(child_resource_id, auth.uid())
);

create policy "users see own or managed shares" on public.resource_shares
for select to authenticated using (
  public.is_account_approved(auth.uid()) and (
    user_id = auth.uid() or public.can_manage_resource_shares(resource_id, auth.uid())
  )
);

create policy "owners see pending resource shares" on public.pending_resource_shares
for select to authenticated using (public.can_manage_resource_shares(resource_id, auth.uid()));

create policy "site admin sees approval audit" on public.account_approval_events
for select to authenticated using (
  public.is_account_approved(auth.uid()) and exists (
    select 1 from public.profiles where id = auth.uid() and is_site_admin
  )
);

alter table public.pages replica identity full;
alter table public.folder_items replica identity full;
alter table public.resource_shares replica identity full;

do $$
declare realtime_table text;
begin
  foreach realtime_table in array array['pages', 'folder_items', 'resource_shares'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = realtime_table
    ) then execute format('alter publication supabase_realtime add table public.%I', realtime_table); end if;
  end loop;
end $$;

drop trigger if exists workspace_items_set_updated_at on public.workspace_items;
create trigger workspace_items_set_updated_at before update on public.workspace_items
for each row execute function public.set_updated_at();
drop trigger if exists folder_items_set_updated_at on public.folder_items;
create trigger folder_items_set_updated_at before update on public.folder_items
for each row execute function public.set_updated_at();
drop trigger if exists resource_shares_set_updated_at on public.resource_shares;
create trigger resource_shares_set_updated_at before update on public.resource_shares
for each row execute function public.set_updated_at();

revoke execute on function public.is_account_approved(uuid) from public, anon;
revoke execute on function public.is_site_admin(uuid) from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon, authenticated;
revoke execute on function public.is_workspace_owner(uuid) from public, anon, authenticated;
revoke execute on function public.is_original_resource_owner(uuid, uuid) from public, anon;
revoke execute on function public.has_direct_resource_share(uuid, uuid) from public, anon;
revoke execute on function public.has_inherited_resource_access(uuid, uuid) from public, anon;
revoke execute on function public.can_view_resource(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_resource(uuid, uuid) from public, anon;
revoke execute on function public.can_invite_resource(uuid, uuid) from public, anon;
revoke execute on function public.can_manage_resource_shares(uuid, uuid) from public, anon;
revoke execute on function public.can_delete_resource(uuid, uuid) from public, anon;
revoke execute on function public.personal_workspace_id(uuid) from public, anon;
revoke execute on function public.touch_resource_audience(uuid) from public, anon, authenticated;
revoke execute on function public.get_resource_permissions(uuid) from public, anon;
revoke execute on function public.assert_no_folder_cycle(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.moderate_account(uuid, text) from public, anon;
revoke execute on function public.get_workspace_tree(uuid) from public, anon;
revoke execute on function public.create_resource(text, text, uuid) from public, anon;
revoke execute on function public.update_resource_title(uuid, text) from public, anon;
revoke execute on function public.move_workspace_item(uuid, uuid, integer) from public, anon;
revoke execute on function public.insert_folder_item(uuid, uuid, integer) from public, anon;
revoke execute on function public.remove_folder_item(uuid, uuid) from public, anon;
revoke execute on function public.share_resource(uuid, text, boolean) from public, anon;
revoke execute on function public.list_resource_shares(uuid) from public, anon;
revoke execute on function public.set_resource_share_invite(uuid, boolean) from public, anon;
revoke execute on function public.revoke_resource_share(uuid) from public, anon;
revoke execute on function public.revoke_pending_resource_share(uuid) from public, anon;
revoke execute on function public.self_remove_resource(uuid) from public, anon;
revoke execute on function public.trash_resource(uuid) from public, anon;
revoke execute on function public.restore_resource(uuid) from public, anon;
revoke execute on function public.permanently_delete_resource(uuid) from public, anon;
revoke execute on function public.purge_expired_resources() from public, anon, authenticated;

grant execute on function public.is_account_approved(uuid) to authenticated;
grant execute on function public.is_site_admin(uuid) to authenticated;
-- These helpers are referenced directly by RLS policies, so authenticated must be able
-- to execute them. They expose boolean/UUID permission facts only; all data reads remain
-- governed by RLS and all mutations remain in the checked RPCs below.
grant execute on function public.is_original_resource_owner(uuid, uuid) to authenticated;
grant execute on function public.has_direct_resource_share(uuid, uuid) to authenticated;
grant execute on function public.has_inherited_resource_access(uuid, uuid) to authenticated;
grant execute on function public.can_view_resource(uuid, uuid) to authenticated;
grant execute on function public.can_edit_resource(uuid, uuid) to authenticated;
grant execute on function public.can_invite_resource(uuid, uuid) to authenticated;
grant execute on function public.can_manage_resource_shares(uuid, uuid) to authenticated;
grant execute on function public.can_delete_resource(uuid, uuid) to authenticated;
grant execute on function public.personal_workspace_id(uuid) to authenticated;
grant execute on function public.get_resource_permissions(uuid) to authenticated;
grant execute on function public.moderate_account(uuid, text) to authenticated;
grant execute on function public.get_workspace_tree(uuid) to authenticated;
grant execute on function public.create_resource(text, text, uuid) to authenticated;
grant execute on function public.update_resource_title(uuid, text) to authenticated;
grant execute on function public.move_workspace_item(uuid, uuid, integer) to authenticated;
grant execute on function public.insert_folder_item(uuid, uuid, integer) to authenticated;
grant execute on function public.remove_folder_item(uuid, uuid) to authenticated;
grant execute on function public.share_resource(uuid, text, boolean) to authenticated;
grant execute on function public.list_resource_shares(uuid) to authenticated;
grant execute on function public.set_resource_share_invite(uuid, boolean) to authenticated;
grant execute on function public.revoke_resource_share(uuid) to authenticated;
grant execute on function public.revoke_pending_resource_share(uuid) to authenticated;
grant execute on function public.self_remove_resource(uuid) to authenticated;
grant execute on function public.trash_resource(uuid) to authenticated;
grant execute on function public.restore_resource(uuid) to authenticated;
grant execute on function public.permanently_delete_resource(uuid) to authenticated;
grant execute on function public.purge_expired_resources() to service_role;
