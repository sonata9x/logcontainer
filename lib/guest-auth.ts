import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashOpaqueToken } from "@/lib/secure-credentials";

export const GUEST_SESSION_COOKIE = "logcontainer_guest_session";
export const GUEST_SESSION_SECONDS = 60 * 60 * 24 * 30;

export async function getGuestLinkContext(token: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  const admin = createSupabaseAdminClient();
  const { data: link } = await admin.from("page_share_links")
    .select("id, page_id, default_access_level, is_active")
    .eq("token_hash", hashOpaqueToken(token)).eq("is_active", true).maybeSingle();
  if (!link) return null;
  const [{ data: page }, { data: log }] = await Promise.all([
    admin.from("pages").select("id, title, page_type, deleted_at, is_archived").eq("id", link.page_id).maybeSingle(),
    admin.from("logs").select("id, visible_entry_count, import_report, platform, updated_at").eq("page_id", link.page_id).maybeSingle()
  ]);
  if (!page || page.page_type !== "log" || page.deleted_at || page.is_archived || !log) return null;
  return { admin, link, page, log };
}

export async function getGuestApiContext(token: string, sessionToken: string | undefined) {
  if (!sessionToken || !/^[A-Za-z0-9_-]{32,128}$/.test(sessionToken)) return null;
  const linkContext = await getGuestLinkContext(token);
  if (!linkContext) return null;
  const { admin, link } = linkContext;
  const { data: session } = await admin.from("guest_sessions")
    .select("id, guest_participant_id, expires_at, revoked_at")
    .eq("token_hash", hashOpaqueToken(sessionToken)).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data: participant } = await admin.from("guest_participants")
    .select("id, page_id, nickname, access_level, revoked_at")
    .eq("id", session.guest_participant_id).eq("page_id", link.page_id).is("revoked_at", null).maybeSingle();
  if (!participant) return null;
  const now = new Date().toISOString();
  await Promise.all([
    admin.from("guest_sessions").update({ last_seen_at: now }).eq("id", session.id),
    admin.from("guest_participants").update({ last_seen_at: now }).eq("id", participant.id)
  ]);
  return { ...linkContext, session, participant, canEdit: participant.access_level === "editor" };
}
