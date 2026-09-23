import type { ImageDisplay, LogEntryDocument, RichNode, RichStyle } from "./types";
import { cloneLogDocument } from "./editor";

export type EditableTextSegment = { id: string; text: string };
export type EditableTextChange = { id: string; text: string };
export type StyledContentTarget = { id: string; label: string; style: RichStyle };
export type RichStyleChange = { id: string; style: RichStyle };
export type EditableImageTarget = {
  id: string;
  kind: "block" | "rich";
  src: string;
  href: string | null;
  alt: string | null;
  caption: string | null;
  align: ImageDisplay["align"];
};
export type EditableImageChange = Omit<EditableImageTarget, "kind">;

function richVisibleText(node: RichNode): string {
  if (node.type === "text") return node.text;
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.alt ?? "이미지";
  if (node.type === "inline-roll") return node.roll.value;
  return node.children.map(richVisibleText).join("");
}

function targetLabel(node: RichNode) {
  const text = richVisibleText(node).replace(/\s+/g, " ").trim();
  return (text || (node.type === "image" ? "이미지" : "꾸민 요소")).slice(0, 80);
}

export function editableTextSegments(document: LogEntryDocument) {
  const segments: EditableTextSegment[] = [];
  const visit = (node: RichNode) => {
    if (node.type === "text") segments.push({ id: node.id, text: node.text });
    else if (node.type === "element") node.children.forEach(visit);
  };
  for (const block of document.blocks) {
    if (block.type === "text") segments.push({ id: block.id, text: block.text });
    else if (block.type === "rich") block.nodes.forEach(visit);
  }
  return segments;
}

export function applyEditableTextChanges(document: LogEntryDocument, changes: EditableTextChange[]) {
  const replacements = new Map(changes.map((change) => [change.id, change.text]));
  const next = cloneLogDocument(document);
  const visit = (node: RichNode): RichNode => {
    if (node.type === "text" && replacements.has(node.id)) return { ...node, text: replacements.get(node.id)! };
    if (node.type === "element") return { ...node, children: node.children.map(visit) };
    return node;
  };
  next.blocks = next.blocks.map((block) => {
    if (block.type === "text" && replacements.has(block.id)) return { ...block, text: replacements.get(block.id)! };
    if (block.type === "rich") return { ...block, nodes: block.nodes.map(visit) };
    return block;
  });
  return next;
}

export function editableImageTargets(document: LogEntryDocument) {
  const targets: EditableImageTarget[] = [];
  const visit = (node: RichNode) => {
    if (node.type === "image") targets.push({ id: node.id, kind: "rich", src: node.src, href: node.href, alt: node.alt, caption: null, align: null });
    else if (node.type === "element") node.children.forEach(visit);
  };
  for (const block of document.blocks) {
    if (block.type === "image") targets.push({ id: block.id, kind: "block", src: block.src, href: block.href, alt: block.alt, caption: block.caption ?? null, align: block.display?.align ?? null });
    else if (block.type === "rich") block.nodes.forEach(visit);
  }
  return targets;
}

export function applyEditableImageChanges(document: LogEntryDocument, changes: EditableImageChange[]) {
  const replacements = new Map(changes.map((change) => [change.id, change]));
  const next = cloneLogDocument(document);
  const visit = (node: RichNode): RichNode => {
    if (node.type === "image") {
      const replacement = replacements.get(node.id);
      return replacement ? { ...node, src: replacement.src, href: replacement.href, alt: replacement.alt } : node;
    }
    return node.type === "element" ? { ...node, children: node.children.map(visit) } : node;
  };
  next.blocks = next.blocks.map((block) => {
    if (block.type === "image") {
      const replacement = replacements.get(block.id);
      return replacement ? { ...block, src: replacement.src, href: replacement.href, alt: replacement.alt, caption: replacement.caption, display: { ...block.display, align: replacement.align } } : block;
    }
    return block.type === "rich" ? { ...block, nodes: block.nodes.map(visit) } : block;
  });
  return next;
}

export function styledContentTargets(document: LogEntryDocument) {
  const targets: StyledContentTarget[] = [];
  const visit = (node: RichNode) => {
    if ((node.type === "element" || node.type === "image") && node.style.length) {
      targets.push({ id: node.id, label: targetLabel(node), style: node.style });
    }
    if (node.type === "element") node.children.forEach(visit);
  };
  for (const block of document.blocks) if (block.type === "rich") block.nodes.forEach(visit);
  return targets;
}

export function hasStyledContent(document: LogEntryDocument) {
  const visit = (node: RichNode): boolean => {
    if ((node.type === "element" || node.type === "image") && node.style.length > 0) return true;
    return node.type === "element" && node.children.some(visit);
  };
  return document.blocks.some((block) => block.type === "rich" && block.nodes.some(visit));
}

export function contentStyleMap(document: LogEntryDocument) {
  const styles = new Map<string, RichStyle>();
  const visit = (node: RichNode) => {
    if (node.type === "element" || node.type === "image") styles.set(node.id, node.style);
    if (node.type === "element") node.children.forEach(visit);
  };
  for (const block of document.blocks) if (block.type === "rich") block.nodes.forEach(visit);
  return styles;
}

export function applyRichStyleChanges(document: LogEntryDocument, changes: RichStyleChange[]) {
  const replacements = new Map(changes.map((change) => [change.id, change.style]));
  const next = cloneLogDocument(document);
  const visit = (node: RichNode): RichNode => {
    if (node.type === "element") return { ...node, style: replacements.get(node.id) ?? node.style, children: node.children.map(visit) };
    if (node.type === "image" && replacements.has(node.id)) return { ...node, style: replacements.get(node.id)! };
    return node;
  };
  next.blocks = next.blocks.map((block) => block.type === "rich" ? { ...block, nodes: block.nodes.map(visit) } : block);
  return next;
}
