-- Preferences are personal to the current registered user, never to a shared log.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  accent_color text not null default '#4F6BED',
  correction_settings jsonb not null default '{
    "remove_html_tags": true,
    "normalize_ellipsis": true,
    "normalize_quotes": true,
    "speaker_tab_format": true,
    "clean_blank_lines": true,
    "mark_handout_position": true,
    "custom_quote_open": "“",
    "custom_quote_close": "”",
    "custom_ellipsis": "…",
    "custom_handout_icon": "★"
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_accent_check check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint user_preferences_corrections_check check (jsonb_typeof(correction_settings) = 'object')
);

insert into public.user_preferences(user_id)
select id from public.profiles on conflict (user_id) do nothing;

create or replace function public.ensure_user_preferences()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_preferences(user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_ensure_user_preferences on public.profiles;
create trigger profiles_ensure_user_preferences after insert on public.profiles
for each row execute function public.ensure_user_preferences();
drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;
create policy "users read own preferences" on public.user_preferences
for select to authenticated using (user_id = auth.uid() and public.is_account_approved(auth.uid()));
create policy "users update own preferences" on public.user_preferences
for update to authenticated using (user_id = auth.uid() and public.is_account_approved(auth.uid()))
with check (user_id = auth.uid());
revoke all on table public.user_preferences from public, anon;
grant select, update on table public.user_preferences to authenticated;
grant all on table public.user_preferences to service_role;

create or replace function public.update_user_preferences(
  next_accent_color text,
  next_correction_settings jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_id uuid := auth.uid();
declare updated_preferences public.user_preferences;
begin
  if not public.is_account_approved(actor_id) then raise exception 'permission denied'; end if;
  if next_accent_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid accent color'; end if;
  if jsonb_typeof(next_correction_settings) <> 'object' then raise exception 'invalid correction settings'; end if;
  if coalesce(jsonb_typeof(next_correction_settings->'remove_html_tags'), '') <> 'boolean'
    or coalesce(jsonb_typeof(next_correction_settings->'normalize_ellipsis'), '') <> 'boolean'
    or coalesce(jsonb_typeof(next_correction_settings->'normalize_quotes'), '') <> 'boolean'
    or coalesce(jsonb_typeof(next_correction_settings->'speaker_tab_format'), '') <> 'boolean'
    or coalesce(jsonb_typeof(next_correction_settings->'clean_blank_lines'), '') <> 'boolean'
    or coalesce(jsonb_typeof(next_correction_settings->'mark_handout_position'), '') <> 'boolean'
    or coalesce(jsonb_typeof(next_correction_settings->'custom_quote_open'), '') <> 'string'
    or coalesce(jsonb_typeof(next_correction_settings->'custom_quote_close'), '') <> 'string'
    or coalesce(jsonb_typeof(next_correction_settings->'custom_ellipsis'), '') <> 'string'
    or coalesce(jsonb_typeof(next_correction_settings->'custom_handout_icon'), '') <> 'string'
  then raise exception 'invalid correction settings'; end if;
  if exists (select 1 from jsonb_each_text(next_correction_settings) item
    where item.key like 'custom_%' and char_length(item.value) > 8)
  then raise exception 'invalid correction marker'; end if;
  insert into public.user_preferences(user_id, accent_color, correction_settings)
  values (actor_id, upper(next_accent_color), next_correction_settings)
  on conflict (user_id) do update set accent_color = excluded.accent_color,
    correction_settings = excluded.correction_settings
  returning * into updated_preferences;
  return jsonb_build_object('accentColor', updated_preferences.accent_color,
    'correctionSettings', updated_preferences.correction_settings);
end;
$$;

revoke all on function public.update_user_preferences(text, jsonb) from public, anon;
grant execute on function public.update_user_preferences(text, jsonb) to authenticated;
