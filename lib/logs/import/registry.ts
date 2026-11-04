import { importRoll20HtmlV2 } from "@/lib/logs/roll20/import-v2";
import { importTakoyakiBoxHtml } from "@/lib/logs/takoyaki-box/import";
import { importCcfoliaHtml } from "@/lib/logs/ccfolia/import";
import { detectImportPlatform } from "./detect";
import { ImportPlatformError, type CanonicalImportResult, type ImportPlatformSelection } from "./types";

export function importLogHtml(source: string, selection: ImportPlatformSelection, options: { separateCasual?: boolean; importedAt?: string; timezoneOffsetMinutes?: number } = {}): CanonicalImportResult {
  let platform = selection === "auto" ? null : selection;
  if (!platform) {
    const detection = detectImportPlatform(source);
    if (detection.ambiguous) throw new ImportPlatformError("HTML 형식을 하나로 판별할 수 없습니다. 플랫폼을 직접 선택해주세요.", "ambiguous");
    if (!detection.platform) throw new ImportPlatformError("지원하는 로그 HTML 형식을 찾지 못했습니다.", "undetected");
    platform = detection.platform;
  }
  if (platform === "roll20") return importRoll20HtmlV2(source, options) as CanonicalImportResult;
  if (platform === "takoyaki-box") return importTakoyakiBoxHtml(source);
  if (platform === "ccfolia") return importCcfoliaHtml(source);
  throw new ImportPlatformError("지원하지 않는 가져오기 플랫폼입니다.", "unsupported");
}
