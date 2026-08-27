import type { LogBlock, LogEntryDocument, RichNode, RichStyle } from "./types";

export type EditableBlockType = LogBlock["type"];

export function cloneLogDocument(document: LogEntryDocument): LogEntryDocument {
  return JSON.parse(JSON.stringify(document)) as LogEntryDocument;
}

export function editorNodeId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${uuid}`;
}

export function styleToEditorText(style: RichStyle) {
  return style.map(({ property, value }) => `${property}: ${value};`).join("\n");
}

export function editorTextToStyle(text: string): RichStyle {
  return text.split(";").flatMap((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return [];
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    return property && value ? [{ property, value }] : [];
  });
}

function rekeyRichNode(node: RichNode): RichNode {
  if (node.type === "text") return { ...node, id: editorNodeId("richtext") };
  if (node.type === "break") return { ...node, id: editorNodeId("break") };
  if (node.type === "image") return { ...node, id: editorNodeId("richimage") };
  if (node.type === "inline-roll") return { ...node, id: editorNodeId("richroll"), roll: { ...node.roll, id: editorNodeId("roll") } };
  return { ...node, id: editorNodeId("element"), children: node.children.map(rekeyRichNode) };
}

export function rekeyBlock(block: LogBlock): LogBlock {
  if (block.type === "text") return { ...block, id: editorNodeId("text") };
  if (block.type === "inline-roll") return { ...block, id: editorNodeId("roll") };
  if (block.type === "image") return { ...block, id: editorNodeId("image") };
  if (block.type === "rich") return { ...block, id: editorNodeId("rich"), nodes: block.nodes.map(rekeyRichNode) };
  return {
    ...block,
    id: editorNodeId("template"),
    fields: block.fields.map((field) => ({ ...field, id: editorNodeId("field"), content: field.content.map((item) => rekeyBlock(item) as typeof item) }))
  };
}

export function createEditableBlock(type: EditableBlockType): LogBlock {
  if (type === "text") return { id: editorNodeId("text"), type, text: "" };
  if (type === "inline-roll") return { id: editorNodeId("roll"), type, value: "", expression: null, state: "normal", tooltip: null, rawFormula: null };
  if (type === "image") return { id: editorNodeId("image"), type, src: "https://", href: null, alt: null, caption: null, display: { width: null, height: null, minWidth: null, maxWidth: null, align: "left" } };
  if (type === "rich") return { id: editorNodeId("rich"), type, nodes: [{ id: editorNodeId("element"), type: "element", tag: "span", href: null, title: null, style: [], children: [{ id: editorNodeId("richtext"), type: "text", text: "꾸민 텍스트" }] }] };
  return { id: editorNodeId("template"), type, template: null, system: "coc7", title: "판정", fields: [], resultLevel: null, resultLabel: null, fallbackText: "판정" };
}

export function replaceBlock(document: LogEntryDocument, blockIndex: number, block: LogBlock) {
  const next = cloneLogDocument(document);
  next.blocks[blockIndex] = block;
  return next;
}

export function moveBlock(document: LogEntryDocument, blockIndex: number, direction: -1 | 1) {
  const target = blockIndex + direction;
  if (target < 0 || target >= document.blocks.length) return cloneLogDocument(document);
  const next = cloneLogDocument(document);
  [next.blocks[blockIndex], next.blocks[target]] = [next.blocks[target], next.blocks[blockIndex]];
  return next;
}

export function removeBlock(document: LogEntryDocument, blockIndex: number) {
  const next = cloneLogDocument(document);
  next.blocks.splice(blockIndex, 1);
  return next;
}

export function duplicateBlock(document: LogEntryDocument, blockIndex: number) {
  const next = cloneLogDocument(document);
  next.blocks.splice(blockIndex + 1, 0, rekeyBlock(next.blocks[blockIndex]));
  return next;
}

export function appendBlock(document: LogEntryDocument, type: EditableBlockType) {
  const next = cloneLogDocument(document);
  next.blocks.push(createEditableBlock(type));
  return next;
}

export function replaceRichNode(nodes: RichNode[], targetId: string, replacement: RichNode | null): RichNode[] {
  return nodes.flatMap((node) => {
    if (node.id === targetId) return replacement ? [replacement] : [];
    if (node.type !== "element") return [node];
    return [{ ...node, children: replaceRichNode(node.children, targetId, replacement) }];
  });
}
