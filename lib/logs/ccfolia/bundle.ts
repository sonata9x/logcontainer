export const CCFOLIA_TABS_FORMAT = "logcontainer-ccfolia-tabs";
export type CcfoliaSourceTab = { path: string; name: string; html: string };

export function serializeCcfoliaTabs(tabs: CcfoliaSourceTab[]) {
  return JSON.stringify({ format: CCFOLIA_TABS_FORMAT, version: 1, tabs });
}

export function parseCcfoliaTabs(source: string): CcfoliaSourceTab[] | null {
  if (!source.trimStart().startsWith("{")) return null;
  const value = JSON.parse(source);
  if (value.format !== CCFOLIA_TABS_FORMAT || value.version !== 1 || !Array.isArray(value.tabs) || !value.tabs.length || value.tabs.length > 1000) throw new Error("코코포리아 탭 원본 형식이 올바르지 않습니다.");
  const paths = new Set<string>();
  return value.tabs.map((tab: unknown) => {
    if (!tab || typeof tab !== "object") throw new Error("코코포리아 탭이 올바르지 않습니다.");
    const item = tab as Record<string, unknown>;
    if (typeof item.path !== "string" || !item.path || paths.has(item.path) || typeof item.name !== "string" || !item.name || typeof item.html !== "string" || !item.html.trim()) throw new Error("코코포리아 탭이 비어 있거나 중복되었습니다.");
    paths.add(item.path);
    return { path: item.path, name: item.name.slice(0, 200), html: item.html };
  });
}
