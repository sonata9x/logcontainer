-- UI typography is personal; pages.font_family remains shared log typography.
alter table public.user_preferences add column if not exists system_font_family
  text not null default 'pretendard';
alter table public.user_preferences drop constraint if exists user_preferences_system_font_check;
alter table public.user_preferences add constraint user_preferences_system_font_check
  check (system_font_family in ('pretendard','gowoon-dodum','goun-batang',
    'ridi-batang','nanum-myeongjo','natural-sans','ibm-plex-sans'));
-- Existing own-user SELECT/UPDATE RLS and grants are intentionally unchanged.
