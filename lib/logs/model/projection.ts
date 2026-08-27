import type { LogBlock, LogEntryDocument, RichNode, RollTemplateField } from "./types";

function richNodeText(node: RichNode): string {
  if (node.type === "text") return node.text;
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.alt ?? "이미지";
  if (node.type === "inline-roll") return node.roll.value;
  return node.children.map(richNodeText).join("");
}

function templateFieldText(field: RollTemplateField) {
  return `${field.label || field.key}: ${field.value}`.trim();
}

export function projectBlockText(block: LogBlock) {
  if (block.type === "text") return block.text;
  if (block.type === "inline-roll") return block.value;
  if (block.type === "image") return block.alt ?? "이미지";
  if (block.type === "rich") return block.nodes.map(richNodeText).join("");
  const current = [block.title, ...block.fields.map(templateFieldText), block.fields.some((field) => field.key === "result") ? null : block.resultLabel].filter(Boolean).join(" / ");
  return current || block.fallbackText;
}

export function projectDocumentText(document: LogEntryDocument) {
  return document.blocks.map(projectBlockText).join("").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isImageOnlyDocument(document: LogEntryDocument) {
  return document.blocks.length > 0
    && document.blocks.some((block) => block.type === "image")
    && document.blocks.every((block) => block.type === "image" || (block.type === "text" && !block.text.trim()));
}
