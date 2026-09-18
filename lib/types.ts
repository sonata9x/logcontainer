import type { LogEntryDocument } from "@/lib/logs/model/types";

export type WorkspaceRole = "owner" | "editor";
export type ResourceRole = "viewer" | "editor" | "admin" | "owner";
export type PageType = "folder" | "log";
export type LogPlatform = "manual" | "roll20" | "takoyaki-box" | "ccfolia" | "other";
export type LogFontFamily = "pretendard" | "gowoon-dodum" | "goun-batang" | "ridi-batang" | "nanum-myeongjo" | "natural-sans" | "ibm-plex-sans";
export type AccountStatus = "pending" | "approved" | "rejected" | "disabled";

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  account_status: AccountStatus;
  is_site_admin: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

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
  original_owner_id: string;
  deleted_at: string | null;
  purge_after?: string | null;
  deleted_by?: string | null;
  tree_parent_id?: string | null;
  tree_depth?: number;
  tree_relation?: "workspace" | "folder";
  resource_role?: ResourceRole;
  is_original_owner?: boolean;
  can_edit?: boolean;
  can_manage_shares?: boolean;
  can_invite?: boolean;
  can_self_remove?: boolean;
  overview?: string | null;
  font_family?: LogFontFamily;
  session_card_path?: string | null;
  session_card_mime?: string | null;
  session_card_size?: number | null;
  created_at: string;
  updated_at: string;
};

export type PageExtras = {
  overview: string | null;
  fontFamily: LogFontFamily;
  sessionCardUrl: string | null;
  sessionCardMime: string | null;
  sessionCardSize: number | null;
};

export type BgmSourceType = "upload" | "youtube";
export type BgmAsset = {
  id: string;
  owner_user_id?: string;
  source_type: BgmSourceType;
  canonical_title: string;
  youtube_video_id?: string | null;
  duration_seconds?: number | null;
  mime_type?: string | null;
  byte_size?: number | null;
};

export type BgmLibraryItem = {
  can_edit_source?: boolean;
  id: string;
  bgm_asset_id: string;
  custom_title: string | null;
  created_at: string;
  asset: BgmAsset;
};

export type BgmPlaylistItem = {
  id: string;
  playlist_id: string;
  bgm_asset_id: string;
  custom_title: string | null;
  sort_order: number;
  asset: BgmAsset;
};

export type BgmPlaylist = {
  id: string;
  title: string;
  source_page_id: string | null;
  created_at: string;
  updated_at: string;
  items: BgmPlaylistItem[];
};

export type PageBgmItem = {
  id: string;
  page_id: string;
  bgm_asset_id: string;
  role: "waiting" | "entry";
  entry_id: string | null;
  sort_order: number;
  custom_title: string | null;
  created_at: string;
  asset: BgmAsset;
};

export type HandoutImage = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  order_index: number;
  url: string;
};

export type Handout = {
  id: string;
  page_id: string;
  title: string;
  content: string;
  order_index: number;
  created_at: string;
  updated_at: string;
  images: HandoutImage[];
};

export type ResourcePermissions = {
  role: ResourceRole;
  canView: boolean;
  canEdit: boolean;
  canManageShares: boolean;
  canManageGuestLink: boolean;
  canPublish: boolean;
  canReimport: boolean;
  canRestoreOriginal: boolean;
  canTrashResource: boolean;
  canSelfRemove: boolean;
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
  sort_key: number;
  has_image_content?: boolean;
  entry_type: "dialogue" | "system" | "dice" | "image" | "handout" | "html";
  speaker_name: string | null;
  speaker_color: string | null;
  content: string;
  original_content?: string | null;
  raw_html: string | null;
  document_version?: number | null;
  document?: LogEntryDocument | null;
  original_document?: LogEntryDocument | null;
  metadata?: Record<string, unknown>;
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
  guest_participant_id?: string | null;
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
  visibility?: "public" | "password";
  password_version?: number;
  published_at: string;
  updated_at: string;
};
