import type { LogEntryDocument } from "@/lib/logs/model/types";

export type ImportPlatformSelection = "auto" | "roll20" | "takoyaki-box" | "ccfolia";
export type SupportedImportPlatform = "roll20" | "takoyaki-box";

export type CanonicalImportEntry = {
  order_index: number;
  entry_type: "dialogue" | "system";
  speaker_name: string | null;
  speaker_color: string | null;
  content: string;
  original_content: null;
  raw_html: null;
  document_version: 2;
  document: LogEntryDocument;
  original_document: null;
  sort_key: number;
  has_image_content: boolean;
  metadata: Record<string, unknown>;
};

export type CanonicalImportResult = {
  platform: SupportedImportPlatform;
  documents: LogEntryDocument[];
  entries: CanonicalImportEntry[];
  report: Record<string, unknown> & { provider: SupportedImportPlatform; parserVersion: number };
};

export class ImportPlatformError extends Error {
  constructor(message: string, public readonly code: "unsupported" | "undetected" | "ambiguous" | "invalid") {
    super(message);
  }
}
