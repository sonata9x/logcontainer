import type { LogFontFamily } from "@/lib/types";
import { logFontPreload } from "@/lib/log-font-preload";

export function LogFontPreload({ font }: { font: LogFontFamily }) {
  const resource = logFontPreload(font);
  return resource ? <link rel="preload" as="font" href={resource.href} type={resource.type} crossOrigin="anonymous" /> : null;
}
