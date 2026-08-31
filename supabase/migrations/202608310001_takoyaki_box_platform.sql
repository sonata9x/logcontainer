-- Takoyaki Box imports use the same canonical v2 log storage as Roll20.
alter table public.logs drop constraint if exists logs_platform_check;
alter table public.logs add constraint logs_platform_check
  check (platform in ('manual', 'roll20', 'takoyaki-box', 'ccfolia', 'other'));
