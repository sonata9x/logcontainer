import { unzipSync } from "fflate";
import { MAX_STAGED_ROLL20_SOURCE_SIZE } from "@/lib/logs/import-limits";
import { serializeCcfoliaTabs } from "./bundle";

export const MAX_CCFOLIA_ZIP_SIZE = 50 * 1024 * 1024;
export type CcfoliaZipTab = { path: string; label: string; size: number };

// Read directory metadata without inflating any member. Only the chosen HTML is extracted.
export function listCcfoliaZipTabs(bytes: Uint8Array): CcfoliaZipTab[] {
  if (!bytes.length || bytes.length > MAX_CCFOLIA_ZIP_SIZE) throw new Error("ZIP 파일은 최대 50MB까지 선택할 수 있습니다.");
  const tabs: CcfoliaZipTab[] = [];
  const paths = new Set<string>();
  let count = 0;
  unzipSync(bytes, { filter(file) {
    if (++count > 1000) throw new Error("ZIP 안의 파일 수가 너무 많습니다.");
    if (!/\.html?$/i.test(file.name) || file.name.startsWith("__MACOSX/")) return false;
    if (paths.has(file.name)) throw new Error("ZIP 안에 같은 이름의 HTML이 중복되어 있습니다.");
    paths.add(file.name);
    const basename = file.name.split(/[\\/]/).at(-1)!;
    tabs.push({ path: file.name, label: basename.match(/\[([^\[\]]+)\]\.html?$/i)?.[1] ?? basename, size: file.originalSize });
    return false;
  } });
  if (!tabs.length) throw new Error("ZIP 안에서 HTML 탭을 찾지 못했습니다.");
  return tabs;
}

export function extractCcfoliaZipTab(bytes: Uint8Array, path: string): Uint8Array {
  const tab = listCcfoliaZipTabs(bytes).find((item) => item.path === path);
  if (!tab) throw new Error("표시할 HTML 탭을 선택해주세요.");
  if (!tab.size || tab.size > MAX_STAGED_ROLL20_SOURCE_SIZE) throw new Error("선택한 HTML은 12MB 이하여야 합니다.");
  const result = unzipSync(bytes, { filter: (file) => file.name === path });
  const payload = result[path];
  if (!payload || payload.length !== tab.size) throw new Error("ZIP의 HTML 파일이 손상되었습니다.");
  new TextDecoder("utf-8", { fatal: true }).decode(payload);
  return payload;
}

export function extractCcfoliaZipTabs(bytes: Uint8Array, paths: string[]): string {
  if (!paths.length) throw new Error("표시할 HTML 탭을 하나 이상 선택해주세요.");
  const requested = new Set(paths);
  const tabs = listCcfoliaZipTabs(bytes).filter((tab) => requested.has(tab.path));
  if (tabs.length !== paths.length) throw new Error("선택한 HTML 탭이 중복되었거나 ZIP에 없습니다.");
  if (tabs.reduce((sum, tab) => sum + tab.size, 0) > MAX_STAGED_ROLL20_SOURCE_SIZE) throw new Error("선택한 HTML 탭의 합계는 12MB 이하여야 합니다.");
  const source = serializeCcfoliaTabs(tabs.map((tab) => ({ path: tab.path, name: tab.label, html: new TextDecoder("utf-8", { fatal: true }).decode(extractCcfoliaZipTab(bytes, tab.path)) })));
  if (new TextEncoder().encode(source).length > MAX_STAGED_ROLL20_SOURCE_SIZE) throw new Error("선택한 탭의 업로드 용량은 합계 12MB 이하여야 합니다.");
  return source;
}
