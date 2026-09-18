export type AdminBgmAsset = {
  id: string; title: string; sourceType: "upload" | "youtube"; byteSize: number | null;
  ready: boolean; deletedAt: string | null; createdAt: string; owner: string;
  pages: Array<{ title: string; deleted: boolean; role: "waiting" | "entry"; entryDeleted: boolean }>;
  playlists: Array<{ title: string; owner: string }>; libraries: string[];
};

export function bgmUsageLabel(asset: Pick<AdminBgmAsset, "pages" | "playlists" | "libraries" | "deletedAt" | "ready">) {
  if (asset.deletedAt) return "삭제 대기 / 재시도 가능";
  if (!asset.ready) return "업로드 미완료";
  if (asset.pages.length) return "페이지에 등록됨";
  if (asset.playlists.length) return "플레이리스트에만 등록됨";
  return asset.libraries.length ? "보관함에만 존재" : "연결 없음";
}

export function recentBgmUpload(asset: Pick<AdminBgmAsset, "sourceType" | "createdAt">, now = Date.now()) {
  return asset.sourceType === "upload" && new Date(asset.createdAt).getTime() > now - 86_400_000;
}

export function formatBgmBytes(value: number | null) { return `${((value ?? 0) / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MB`; }
