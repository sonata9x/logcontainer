import { SPEAKER_AVATAR_MAX_BYTES, SPEAKER_AVATAR_TYPES, speakerAvatarExtension } from "@/lib/speaker-avatars";

function allowedHostname(hostname: string) {
  const ownHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { return ""; } })();
  return hostname === ownHost
    || hostname === "s3.amazonaws.com"
    || hostname === "files.d20.io"
    || hostname.endsWith(".d20.io")
    || hostname.endsWith(".roll20.net")
    || hostname.endsWith(".cloudfront.net")
    || hostname.endsWith(".supabase.co");
}

export function validImportedAvatarSource(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && allowedHostname(url.hostname.toLowerCase());
  } catch { return false; }
}

function hasImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") return bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null;
  if (mimeType === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function downloadImportedSpeakerAvatar(sourceUrl: string) {
  if (!validImportedAvatarSource(sourceUrl)) throw new Error("가져온 아바타 주소를 안전하게 불러올 수 없습니다. 이미지를 직접 등록해주세요.");
  const response = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { accept: "image/png,image/jpeg,image/gif,image/webp" } });
  if (!response.ok || !validImportedAvatarSource(response.url)) throw new Error("가져온 아바타 원본에 접근하지 못했습니다. 이미지를 직접 등록해주세요.");
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (!SPEAKER_AVATAR_TYPES.has(mimeType) || declaredSize > SPEAKER_AVATAR_MAX_BYTES || !response.body) throw new Error("가져온 아바타 파일 형식을 지원하지 않습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteSize += value.byteLength;
    if (byteSize > SPEAKER_AVATAR_MAX_BYTES) { await reader.cancel(); throw new Error("가져온 아바타가 5MB를 초과합니다."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!byteSize || !hasImageSignature(bytes, mimeType)) throw new Error("가져온 아바타 이미지가 올바르지 않습니다.");
  return { bytes, byteSize, mimeType, extension: speakerAvatarExtension(mimeType) };
}
