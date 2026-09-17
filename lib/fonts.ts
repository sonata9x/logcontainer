import type { LogFontFamily } from "@/lib/types";

export const LOG_FONT_OPTIONS: ReadonlyArray<{ value: LogFontFamily; label: string }> = [
  { value: "pretendard", label: "Pretendard" },
  { value: "gowoon-dodum", label: "고운 돋움" },
  { value: "goun-batang", label: "고운 바탕" },
  { value: "ridi-batang", label: "리디바탕" },
  { value: "nanum-myeongjo", label: "나눔명조" },
  { value: "natural-sans", label: "내추럴 산스" },
  { value: "ibm-plex-sans", label: "IBM Plex Sans KR" }
];

const FONT_STACKS: Record<LogFontFamily, string> = {
  pretendard: 'Pretendard, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "gowoon-dodum": "GowoonDodum, sans-serif",
  "goun-batang": "GounBatang, serif",
  "ridi-batang": 'Ridibatang, "Nanum Myeongjo", serif',
  "nanum-myeongjo": '"Nanum Myeongjo", serif',
  "natural-sans": "NaturalSans, Pretendard, sans-serif",
  "ibm-plex-sans": "IbmPlexSans, sans-serif"
};

export function isLogFontFamily(value: unknown): value is LogFontFamily {
  return typeof value === "string" && Object.hasOwn(FONT_STACKS, value);
}

export function parseLogFontFamily(value: unknown): LogFontFamily {
  return isLogFontFamily(value) ? value : "pretendard";
}

export function fontFamilyStack(value: unknown): string {
  return FONT_STACKS[parseLogFontFamily(value)];
}
