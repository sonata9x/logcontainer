import type { LogFontFamily, LogPlatform } from "@/lib/types";

export const EXTERNAL_LOG_EXPORT_FORMAT = "logcontainer-static-log" as const;
export const EXTERNAL_LOG_EXPORT_VERSION = 1 as const;

export type ExternalExportTrack = {
  key: string;
  title: string;
  source:
    | { type: "upload"; file: string; mimeType: "audio/mpeg"; originalFilename: string | null }
    | { type: "youtube"; videoId: string };
};

export type ExternalExportBgmPlacement = {
  key: string;
  trackKey: string;
  title: string;
  role: "waiting" | "entry";
  entryKey: string | null;
  sortOrder: number;
};

export type ExternalExportEntry = {
  key: string;
  html: string;
  compactSpacing: boolean;
  stream: "main" | "casual";
};

export type ExternalExportHandout = {
  key: string;
  title: string;
  content: string;
  images: Array<{ file: string; originalName: string; mimeType: string }>;
};

export type ExternalLogExportManifest = {
  format: typeof EXTERNAL_LOG_EXPORT_FORMAT;
  version: typeof EXTERNAL_LOG_EXPORT_VERSION;
  exportedAt: string;
  page: {
    title: string;
    platform: LogPlatform;
    fontFamily: LogFontFamily;
    overview: string | null;
    sessionCardFile: string | null;
  };
  entries: ExternalExportEntry[];
  tracks: ExternalExportTrack[];
  bgm: ExternalExportBgmPlacement[];
  handouts: ExternalExportHandout[];
};

export type ExternalExportAsset = {
  path: string;
  url: string;
  byteSize: number | null;
};

export type ExternalExportPayload = {
  filename: string;
  manifest: ExternalLogExportManifest;
  assets: ExternalExportAsset[];
  totalEntries: number;
  nextOffset: number | null;
};
