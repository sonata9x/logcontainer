import type { LogFontFamily } from "@/lib/types";

// These are the same single-file faces declared in globals.css. Google Fonts
// uses subsetted stylesheets, so do not guess its WOFF URLs here.
const DIRECT_FONTS: Partial<Record<LogFontFamily, { href: string; type: string }>> = {
  "gowoon-dodum": { href: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.1/GowunDodum-Regular.woff", type: "font/woff" },
  "goun-batang": { href: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.1/GowunBatang-Regular.woff", type: "font/woff" },
  "ridi-batang": { href: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/RIDIBatang.woff", type: "font/woff" },
  "natural-sans": { href: "https://cdn.jsdelivr.net/gh/Project-Noonnu/2607201621@jayeonsans-medium/jayeonsans-medium/JayeonSans-Regular.woff2", type: "font/woff2" }
};

export function logFontPreload(font: LogFontFamily) {
  return DIRECT_FONTS[font] ?? null;
}
