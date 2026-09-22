import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogEntry, LogPlatform, SpeakerAvatarBundle, SpeakerAvatarProfile, SpeakerAvatarVariant } from "@/lib/types";

export const SPEAKER_AVATAR_BUCKET = "speaker-avatars";
export const SPEAKER_AVATAR_MAX_BYTES = 5_000_000;
export const SPEAKER_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const SPEAKER_AVATAR_PLATFORMS = new Set<LogPlatform>(["roll20", "takoyaki-box"]);

export function normalizeSpeakerKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function normalizeVariantKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function validSpeakerAvatar(mimeType: unknown, byteSize: unknown) {
  return typeof mimeType === "string" && SPEAKER_AVATAR_TYPES.has(mimeType)
    && typeof byteSize === "number" && Number.isSafeInteger(byteSize)
    && byteSize > 0 && byteSize <= SPEAKER_AVATAR_MAX_BYTES;
}

export function speakerAvatarExtension(mimeType: string) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[mimeType] ?? "bin";
}

type ProfileRow = { id: string; speaker_key: string; speaker_name: string };
type VariantRow = { id: string; profile_id: string; name: string; is_default: boolean; storage_path: string; original_filename: string | null; sort_order: number };

export async function getSpeakerAvatarBundle(admin: SupabaseClient, pageId: string): Promise<SpeakerAvatarBundle> {
  const [{ data: log }, { data: speakers }, { data: profiles }] = await Promise.all([
    admin.from("logs").select("id, platform").eq("page_id", pageId).maybeSingle(),
    admin.rpc("list_page_log_speakers", { target_page_id: pageId }),
    admin.from("page_speaker_profiles").select("id, speaker_key, speaker_name").eq("page_id", pageId)
  ]);
  const platform = (log?.platform ?? "other") as LogPlatform;
  if (!SPEAKER_AVATAR_PLATFORMS.has(platform)) return { enabled: false, platform, profiles: [], entryOverrides: {} };
  const profileRows = (profiles ?? []) as ProfileRow[];
  const profileIdList = profileRows.map((profile) => profile.id);
  const { data: variants } = profileIdList.length
    ? await admin.from("speaker_avatar_variants").select("id, profile_id, name, is_default, storage_path, original_filename, sort_order").in("profile_id", profileIdList).order("sort_order").order("created_at")
    : { data: [] };
  const variantRows = (variants ?? []) as VariantRow[];
  const variantIds = variantRows.map((variant) => variant.id);
  const { data: overrides } = variantIds.length
    ? await admin.from("log_entry_avatar_overrides").select("entry_id, variant_id").in("variant_id", variantIds)
    : { data: [] };
  const paths = variantRows.map((variant) => variant.storage_path);
  const signed = paths.length ? await admin.storage.from(SPEAKER_AVATAR_BUCKET).createSignedUrls(paths, 60 * 60) : { data: [] as Array<{ path: string; signedUrl: string }> };
  const urls = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
  const variantsByProfile = new Map<string, SpeakerAvatarVariant[]>();
  for (const variant of variantRows) {
    const imageUrl = urls.get(variant.storage_path);
    if (!imageUrl) continue;
    const list = variantsByProfile.get(variant.profile_id) ?? [];
    list.push({ id: variant.id, name: variant.name, isDefault: variant.is_default, imageUrl, originalFilename: variant.original_filename, sortOrder: variant.sort_order });
    variantsByProfile.set(variant.profile_id, list);
  }
  const byKey = new Map(profileRows.map((profile) => [profile.speaker_key, profile]));
  const result: SpeakerAvatarProfile[] = (speakers ?? []).map((speaker: { speaker_name: string; message_count: number | string }) => {
    const speakerKey = normalizeSpeakerKey(speaker.speaker_name);
    const profile = byKey.get(speakerKey);
    return { id: profile?.id ?? null, speakerKey, speakerName: speaker.speaker_name, messageCount: Number(speaker.message_count), variants: profile ? variantsByProfile.get(profile.id) ?? [] : [] };
  });
  for (const profile of profileRows) if (!result.some((item) => item.speakerKey === profile.speaker_key)) result.push({ id: profile.id, speakerKey: profile.speaker_key, speakerName: profile.speaker_name, messageCount: 0, variants: variantsByProfile.get(profile.id) ?? [] });
  return { enabled: true, platform, profiles: result, entryOverrides: Object.fromEntries((overrides ?? []).map((item: { entry_id: string; variant_id: string }) => [item.entry_id, item.variant_id])) };
}

export function speakerNameForEntry(entry: LogEntry) {
  return entry.document_version === 2 && entry.document ? entry.document.speaker?.name?.trim() || null : entry.speaker_name?.trim() || null;
}

export function resolveEntryAvatar(entry: LogEntry, bundle: SpeakerAvatarBundle | null | undefined) {
  if (!bundle?.enabled) return { candidates: [] as string[], managed: false, profile: null as SpeakerAvatarProfile | null, selectedVariantId: null as string | null };
  const speakerName = speakerNameForEntry(entry);
  const profile = speakerName ? bundle.profiles.find((item) => item.speakerKey === normalizeSpeakerKey(speakerName)) ?? null : null;
  const selectedVariantId = bundle.entryOverrides[entry.id] ?? null;
  const selected = profile?.variants.find((item) => item.id === selectedVariantId) ?? null;
  const defaultVariant = profile?.variants.find((item) => item.isDefault) ?? null;
  const original = entry.document_version === 2 && entry.document ? entry.document.speaker?.avatarUrl ?? null : null;
  return { candidates: [...new Set([selected?.imageUrl, defaultVariant?.imageUrl, original].filter((value): value is string => Boolean(value)))], managed: Boolean(selected || defaultVariant), profile, selectedVariantId };
}
