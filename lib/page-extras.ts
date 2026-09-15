import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogFontFamily, PageExtras } from "@/lib/types";

export const SESSION_CARD_BUCKET = "session-cards";
export const SESSION_CARD_MAX_BYTES = 10_000_000;
export const SESSION_CARD_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const LOG_FONT_OPTIONS: ReadonlyArray<{ value: LogFontFamily; label: string }> = [
  { value: "pretendard", label: "Pretendard" },
  { value: "gowoon-dodum", label: "고운 돋움" },
  { value: "goun-batang", label: "고운 바탕" },
  { value: "ridi-batang", label: "리디바탕" },
  { value: "nanum-myeongjo", label: "나눔명조" },
  { value: "natural-sans", label: "내추럴 산스" },
  { value: "ibm-plex-sans", label: "IBM Plex Sans KR" }
];

const LOG_FONT_VALUES = new Set(LOG_FONT_OPTIONS.map((option) => option.value));

export function parseLogFontFamily(value: unknown): LogFontFamily {
  return typeof value === "string" && LOG_FONT_VALUES.has(value as LogFontFamily)
    ? value as LogFontFamily
    : "pretendard";
}

export function validSessionCard(mimeType: unknown, byteSize: unknown) {
  return typeof mimeType === "string" && SESSION_CARD_TYPES.has(mimeType)
    && typeof byteSize === "number" && Number.isSafeInteger(byteSize)
    && byteSize > 0 && byteSize <= SESSION_CARD_MAX_BYTES;
}

export function sessionCardExtension(mimeType: string) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[mimeType] ?? "bin";
}

type PageExtrasRow = {
  overview?: string | null;
  font_family?: string | null;
  session_card_path?: string | null;
  session_card_mime?: string | null;
  session_card_size?: number | null;
};

export async function serializePageExtras(admin: SupabaseClient, row: PageExtrasRow | null): Promise<PageExtras> {
  let sessionCardUrl: string | null = null;
  if (row?.session_card_path) {
    const { data } = await admin.storage.from(SESSION_CARD_BUCKET).createSignedUrl(row.session_card_path, 60 * 60);
    sessionCardUrl = data?.signedUrl ?? null;
  }
  return {
    overview: row?.overview ?? null,
    fontFamily: parseLogFontFamily(row?.font_family),
    sessionCardUrl,
    sessionCardMime: row?.session_card_mime ?? null,
    sessionCardSize: row?.session_card_size ?? null
  };
}

export async function purgeExpiredSessionCards(admin: SupabaseClient) {
  const { data: pages, error } = await admin.from("pages").select("session_card_path").not("session_card_path", "is", null).not("deleted_at", "is", null).lte("purge_after", new Date().toISOString()).limit(500);
  if (error) throw new Error("expired session card lookup failed");
  const paths = (pages ?? []).map((page) => page.session_card_path).filter((path): path is string => Boolean(path));
  if (!paths.length) return 0;
  const { error: removeError } = await admin.storage.from(SESSION_CARD_BUCKET).remove(paths);
  if (removeError) throw new Error("expired session card cleanup failed");
  return paths.length;
}
