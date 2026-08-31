export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  const short = trimmed.match(/^#([0-9A-F]{3})$/);
  if (short) return `#${[...short[1]].map((digit) => digit + digit).join("")}`;
  return /^#[0-9A-F]{6}$/.test(trimmed) ? trimmed : null;
}
