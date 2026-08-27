import type { LogEntryDocument } from "@/lib/logs/model/types";

export type WorkspaceRole = "owner" | "editor";
export type PageType = "folder" | "log";
export type LogPlatform = "manual" | "roll20" | "ccfolia" | "other";

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkspacePage = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  page_type: PageType;
  title: string;
  icon: string | null;
  order_index: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type TrpgLog = {
  id: string;
  page_id: string;
  platform: LogPlatform;
  original_html: string | null;
  custom_css: string | null;
  import_report: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LogEntry = {
  id: string;
  log_id: string;
  order_index: number;
  entry_type: "dialogue" | "system" | "dice" | "image" | "handout" | "html";
  speaker_name: string | null;
  speaker_color: string | null;
  content: string;
  original_content: string;
  raw_html: string | null;
  document_version?: number | null;
  document?: LogEntryDocument | null;
  original_document?: LogEntryDocument | null;
  metadata: Record<string, unknown>;
  is_deleted: boolean;
  deleted_at: string | null;
  is_added: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LogEntryRevision = {
  id: string;
  entry_id: string;
  editor_id: string | null;
  action: "edit" | "delete" | "restore" | "revert";
  previous_content: string;
  next_content: string;
  previous_snapshot?: LogEntryDocument | null;
  next_snapshot?: LogEntryDocument | null;
  revision_schema_version?: number | null;
  created_at: string;
};

export type Publication = {
  id: string;
  page_id: string;
  token: string;
  is_active: boolean;
  published_at: string;
  updated_at: string;
};
