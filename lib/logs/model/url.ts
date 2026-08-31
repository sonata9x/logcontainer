export const MAX_EMBEDDED_IMAGE_URL_LENGTH = 5_000_000;

export function safeHttpsUrl(value: unknown, nullable = true): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^data:image\//i.test(value)) {
    if (value.length > MAX_EMBEDDED_IMAGE_URL_LENGTH) return null;
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value) ? value : null;
  }
  return safeHttpsUrl(value, false);
}
