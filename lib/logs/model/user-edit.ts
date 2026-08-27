import type { LogEntryDocument, RichNode, RichStyle } from "./types";
import { cloneLogDocument } from "./editor";

export type EditableTextSegment = { id: string; text: string };
export type EditableTextChange = { id: string; text: string };
export type StyledContentTarget = { id: string; label: string; style: RichStyle };
export type RichStyleChange = { id: string; style: RichStyle };

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
