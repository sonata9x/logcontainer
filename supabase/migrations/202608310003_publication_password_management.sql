-- Publication hashes are server-only. Management UI uses security-definer RPCs,
-- while current-password verification runs in the authenticated server route.
revoke all on table public.publications from public, anon, authenticated;
