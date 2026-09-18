export type PagePlaylistUsage = { bgm_asset_id: string; custom_title: string | null };

export function canImportPageBgm({ pageId, publicationTokenProvided, publication, canViewPage }: {
  pageId: string; publicationTokenProvided: boolean;
  publication: { pageId: string; authorized: boolean } | null; canViewPage: boolean;
}) {
  // Supplying an invalid/locked publication must never fall back to private access.
  return publicationTokenProvided
    ? Boolean(publication?.authorized && publication.pageId === pageId)
    : canViewPage;
}

/** Snapshot the page's current tracks, never its message positions or future changes. */
export function uniquePagePlaylistUsages(usages: PagePlaylistUsage[]) {
  const seen = new Set<string>();
  return usages.filter((usage) => {
    if (seen.has(usage.bgm_asset_id)) return false;
    seen.add(usage.bgm_asset_id);
    return true;
  });
}
