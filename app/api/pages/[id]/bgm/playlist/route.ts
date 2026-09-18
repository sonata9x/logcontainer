import { NextRequest, NextResponse } from "next/server";
import { getApiPageContext, getApprovedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";
import { canImportPageBgm, uniquePagePlaylistUsages, type PagePlaylistUsage } from "@/lib/bgm-playlist";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getApprovedApiContext();
  if (!viewer) return NextResponse.json({ error: "로그인한 뒤 내 플레이리스트에 담을 수 있습니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const publication = typeof body.publicationToken === "string"
    ? await getPublicationAccess(body.publicationToken, request.cookies.get(PUBLICATION_SESSION_COOKIE)?.value) : null;
  const page = publication ? null : await getApiPageContext(id);
  const authorizedPublication = publication?.authorized && publication.page.id === id;
  if (!canImportPageBgm({ pageId: id, publicationTokenProvided: typeof body.publicationToken === "string",
    publication: publication ? { pageId: publication.page.id, authorized: publication.authorized } : null,
    canViewPage: Boolean(page?.permissions.canView)
  })) {
    return NextResponse.json({ error: "로그 열람 권한이 없습니다." }, { status: 403 });
  }
  // Admin is used only after publication authorization, and only for its page/own playlist.
  const source = authorizedPublication ? publication.admin : viewer.supabase;
  const usages: PagePlaylistUsage[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await source.from("page_bgm_items")
      .select("bgm_asset_id, custom_title, role, entry:log_entries(is_deleted), asset:bgm_assets!inner(is_ready, deleted_at)")
      .eq("page_id", id).eq("asset.is_ready", true).is("asset.deleted_at", null)
      .order("role").order("sort_order").order("created_at").order("id").range(offset, offset + 499);
    if (error) return databaseErrorResponse(error, "로그 BGM을 불러오지 못했습니다.");
    for (const item of data ?? []) {
      const entry = Array.isArray(item.entry) ? item.entry[0] : item.entry;
      if (item.role === "waiting" || (entry && !entry.is_deleted)) {
        usages.push({ bgm_asset_id: item.bgm_asset_id, custom_title: item.custom_title });
      }
    }
    if ((data?.length ?? 0) < 500) break;
  }
  const unique = uniquePagePlaylistUsages(usages);
  if (!unique.length) return NextResponse.json({ error: "현재 로그에 등록된 BGM이 없습니다." }, { status: 400 });
  const playlistId = typeof body.playlistId === "string" ? body.playlistId : null;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!playlistId && !title) return NextResponse.json({ error: "플레이리스트 제목을 입력해주세요." }, { status: 400 });
  const target = playlistId
    ? await viewer.supabase.from("bgm_playlists").select("id, title").eq("id", playlistId).eq("user_id", viewer.user.id).maybeSingle()
    : await viewer.supabase.from("bgm_playlists").insert({ user_id: viewer.user.id, title }).select("id, title").single();
  if (target.error) return databaseErrorResponse(target.error, "플레이리스트를 준비하지 못했습니다.");
  if (!target.data) return NextResponse.json({ error: "내 플레이리스트를 찾지 못했습니다." }, { status: 404 });
  const playlist = target.data;
  const rollbackNewPlaylist = async () => {
    if (!playlistId) await viewer.supabase.from("bgm_playlists").delete().eq("id", playlist.id).eq("user_id", viewer.user.id);
  };
  const existing = new Set<string>();
  let nextOrder = 0;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await viewer.supabase.from("bgm_playlist_items").select("bgm_asset_id, sort_order")
      .eq("playlist_id", playlist.id).order("sort_order").order("id").range(offset, offset + 499);
    if (error) { await rollbackNewPlaylist(); return databaseErrorResponse(error, "플레이리스트 곡을 불러오지 못했습니다."); }
    for (const item of data ?? []) { existing.add(item.bgm_asset_id); nextOrder = Math.max(nextOrder, item.sort_order + 1); }
    if ((data?.length ?? 0) < 500) break;
  }
  const additions = unique.filter((usage) => !existing.has(usage.bgm_asset_id));
  if (additions.length) {
    const { data, count, error } = await source.from("bgm_playlist_items").upsert(additions.map((usage, index) => ({
      playlist_id: playlist.id, bgm_asset_id: usage.bgm_asset_id, custom_title: usage.custom_title, sort_order: nextOrder + index
    })), { onConflict: "playlist_id,bgm_asset_id", ignoreDuplicates: true, count: "exact" }).select("id");
    if (error) { await rollbackNewPlaylist(); return databaseErrorResponse(error, "로그 BGM을 플레이리스트에 담지 못했습니다."); }
    const addedCount = count ?? data?.length ?? 0;
    return NextResponse.json({ playlist, addedCount, existingCount: unique.length - addedCount }, { status: playlistId ? 200 : 201 });
  }
  return NextResponse.json({ playlist, addedCount: 0, existingCount: unique.length });
}
