import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashOpaqueToken } from "@/lib/secure-credentials";

export const PUBLICATION_SESSION_COOKIE = "logcontainer_publication_session";
export const PUBLICATION_SESSION_SECONDS = 60 * 60 * 24 * 7;

export async function getPublicationContext(token: string) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(token)) return null;
  const admin = createSupabaseAdminClient();
  const { data: publication } = await admin.from("publications")
    .select("id, page_id, token, is_active, visibility, password_hash, password_version, published_at")
    .eq("token", token).eq("is_active", true).maybeSingle();
  if (!publication) return null;
  const [{ data: page }, { data: log }] = await Promise.all([
    admin.from("pages").select("id, title, page_type, is_archived, deleted_at").eq("id", publication.page_id).maybeSingle(),
    admin.from("logs").select("id, visible_entry_count").eq("page_id", publication.page_id).maybeSingle()
  ]);
  if (!page || page.page_type !== "log" || page.is_archived || page.deleted_at || !log) return null;
  return { admin, publication, page, log };
}

export async function getPublicationAccess(token: string, sessionToken?: string) {
  const context = await getPublicationContext(token);
  if (!context) return null;
  if (context.publication.visibility === "public") return { ...context, authorized: true };
  if (!sessionToken) return { ...context, authorized: false };
  const { data: session } = await context.admin.from("publication_sessions")
    .select("id").eq("publication_id", context.publication.id)
    .eq("token_hash", hashOpaqueToken(sessionToken))
    .eq("password_version", context.publication.password_version)
    .is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  return { ...context, authorized: Boolean(session) };
}
