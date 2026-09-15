export type TreePlacement = {
  id: string;
  order_index: number;
  tree_parent_id?: string | null;
  tree_relation?: "workspace" | "folder";
};

export type ResourceReorder<T extends TreePlacement> = {
  pages: T[];
  before: T[];
  ordered: T[];
  parentId: string | null;
  relation: "workspace" | "folder";
};

function sameContainer(left: TreePlacement, right: TreePlacement) {
  return (left.tree_parent_id ?? null) === (right.tree_parent_id ?? null)
    && (left.tree_relation ?? "workspace") === (right.tree_relation ?? "workspace");
}

export function previewSiblingResourceReorder<T extends TreePlacement>(pages: T[], draggedIds: string[], targetId: string, position: "before" | "after"): ResourceReorder<T> | null {
  const target = pages.find((page) => page.id === targetId);
  if (!target || draggedIds.includes(targetId)) return null;
  const dragged = new Set(draggedIds);
  const moving = pages.filter((page) => dragged.has(page.id));
  if (!moving.length || moving.length !== dragged.size || moving.some((page) => !sameContainer(page, target))) return null;
  const siblings = pages.filter((page) => sameContainer(page, target));
  const remaining = siblings.filter((page) => !dragged.has(page.id));
  const targetIndex = remaining.findIndex((page) => page.id === targetId);
  if (targetIndex < 0) return null;
  const insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  const orderedSiblings = [...remaining.slice(0, insertionIndex), ...moving, ...remaining.slice(insertionIndex)];
  if (siblings.every((page, index) => page.id === orderedSiblings[index]?.id)) return null;
  const normalizedSiblings = orderedSiblings.map((page, index) => ({ ...page, order_index: index }));
  let siblingIndex = 0;
  const nextPages = pages.map((page) => sameContainer(page, target) ? normalizedSiblings[siblingIndex++] : page);
  return {
    pages: nextPages,
    before: siblings,
    ordered: normalizedSiblings,
    parentId: target.tree_parent_id ?? null,
    relation: target.tree_relation ?? "workspace"
  };
}

export function wouldCreateResourceCycle(targetId: string, movingIds: string[], pages: TreePlacement[]) {
  const moving = new Set(movingIds);
  const parentById = new Map(pages.map((page) => [page.id, page.tree_parent_id ?? null]));
  let currentId: string | null = targetId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    if (moving.has(currentId)) return true;
    visited.add(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  return false;
}
