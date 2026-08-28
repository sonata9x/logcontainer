-- Server-side abuse protection. Only a service-role client can consume or purge buckets.
create table if not exists public.security_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash),
  check (length(scope) between 1 and 80),
  check (key_hash ~ '^[a-f0-9]{64}$')
);

alter table public.security_rate_limits enable row level security;
revoke all on table public.security_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.security_rate_limits to service_role;

create or replace function public.consume_security_rate_limit(
  rate_key_hash text,
  rate_scope text,
  window_seconds integer,
  max_requests integer,
  block_seconds integer
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare current_row public.security_rate_limits;
declare rate_now timestamptz := clock_timestamp();
declare retry_after integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'permission denied'; end if;
  if rate_key_hash !~ '^[a-f0-9]{64}$' or length(rate_scope) not between 1 and 80 then raise exception 'invalid rate limit key'; end if;
  if window_seconds not between 1 and 86400 or max_requests not between 1 and 10000 or block_seconds not between 1 and 604800 then
    raise exception 'invalid rate limit policy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(rate_scope || ':' || rate_key_hash, 0));
  select * into current_row from public.security_rate_limits
  where scope = rate_scope and key_hash = rate_key_hash for update;

  if current_row.scope is null then
    insert into public.security_rate_limits(scope, key_hash, window_started_at, request_count, updated_at)
    values (rate_scope, rate_key_hash, rate_now, 1, rate_now);
    return jsonb_build_object('allowed', true, 'retryAfter', 0);
  end if;

  if current_row.blocked_until is not null and current_row.blocked_until > rate_now then
    retry_after := greatest(1, ceil(extract(epoch from current_row.blocked_until - rate_now))::integer);
    return jsonb_build_object('allowed', false, 'retryAfter', retry_after);
  end if;

  if current_row.window_started_at + make_interval(secs => window_seconds) <= rate_now then
    update public.security_rate_limits set window_started_at = rate_now, request_count = 1,
      blocked_until = null, updated_at = rate_now
    where scope = rate_scope and key_hash = rate_key_hash;
    return jsonb_build_object('allowed', true, 'retryAfter', 0);
  end if;

  if current_row.request_count + 1 > max_requests then
    update public.security_rate_limits set request_count = request_count + 1,
      blocked_until = rate_now + make_interval(secs => block_seconds), updated_at = rate_now
    where scope = rate_scope and key_hash = rate_key_hash;
    return jsonb_build_object('allowed', false, 'retryAfter', block_seconds);
  end if;

  update public.security_rate_limits set request_count = request_count + 1, updated_at = rate_now
  where scope = rate_scope and key_hash = rate_key_hash;
  return jsonb_build_object('allowed', true, 'retryAfter', 0);
end;
$$;

create or replace function public.purge_security_rate_limits()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare purged_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'permission denied'; end if;
  delete from public.security_rate_limits
  where updated_at < now() - interval '2 days'
    and (blocked_until is null or blocked_until < now());
  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke execute on function public.consume_security_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, text, integer, integer, integer) to service_role;
revoke execute on function public.purge_security_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_security_rate_limits() to service_role;
