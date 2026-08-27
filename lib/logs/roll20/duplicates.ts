import type { ImageBlock, LogEntryDocument, RichNode } from "@/lib/logs/model/types";

function richImageStructure(nodes: RichNode[]): unknown[] | null {
  const structure: unknown[] = [];
  for (const node of nodes) {
    if (node.type === "text" && !node.text.trim()) continue;
    if (node.type === "break") { structure.push({ type: "break" }); continue; }
    if (node.type === "image") { structure.push({ type: "image", src: new URL(node.src).href, href: node.href ? new URL(node.href).href : null, style: node.style }); continue; }
    if (node.type === "element") {
      const nested = richImageStructure(node.children);
      if (nested) { structure.push({ type: "element", tag: node.tag, style: node.style, children: nested }); continue; }
    }
    return null;
  }
  return structure.some((item) => JSON.stringify(item).includes('"type":"image"')) ? structure : null;
}

function imageOnlyFingerprint(document: LogEntryDocument) {
  const structure: unknown[] = [];
  for (const block of document.blocks) {
    if (block.type === "text" && !block.text.trim()) continue;
    if (block.type === "image") { const image = block as ImageBlock; structure.push({ type: "image", src: new URL(image.src).href, href: image.href ? new URL(image.href).href : null, display: image.display ?? null }); continue; }
    if (block.type === "rich") {
      const nested = richImageStructure(block.nodes);
      if (nested) { structure.push({ type: "rich", nodes: nested }); continue; }
    }
    return null;
  }
  if (!structure.length) return null;
  return JSON.stringify({ kind: document.kind, speaker: document.speaker?.name ?? null, structure });
}

export function filterErrorImageDuplicates(documents: LogEntryDocument[], enabled: boolean) {
  if (!enabled) return { documents, errorDuplicateCount: 0 };
  const kept: LogEntryDocument[] = [];
  let errorDuplicateCount = 0;
  for (const document of documents) {
    const previous = kept.at(-1);
    const currentFingerprint = imageOnlyFingerprint(document);
    const previousFingerprint = previous ? imageOnlyFingerprint(previous) : null;
    if (currentFingerprint && currentFingerprint === previousFingerprint) { errorDuplicateCount += 1; continue; }
    kept.push(document);
  }
  return { documents: kept, errorDuplicateCount };
}
