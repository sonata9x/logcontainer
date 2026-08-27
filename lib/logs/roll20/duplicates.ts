import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogBlock, LogEntryDocument, RichNode } from "@/lib/logs/model/types";

function inlineRollFingerprint(block: Extract<LogBlock, { type: "inline-roll" }>) {
  return { type: block.type, value: block.value, expression: block.expression, state: block.state, tooltip: block.tooltip ?? null, rawFormula: block.rawFormula ?? null };
}

function richNodeFingerprint(node: RichNode): unknown {
  if (node.type === "text") return { type: node.type, text: node.text };
  if (node.type === "break") return { type: node.type };
  if (node.type === "image") return { type: node.type, src: node.src, href: node.href, alt: node.alt, style: node.style };
  if (node.type === "inline-roll") return { type: node.type, roll: inlineRollFingerprint(node.roll) };
  return { type: node.type, tag: node.tag, href: node.href, title: node.title, style: node.style, children: node.children.map(richNodeFingerprint) };
}

function blockFingerprint(block: LogBlock): unknown {
  if (block.type === "text") return { type: block.type, text: block.text };
  if (block.type === "inline-roll") return inlineRollFingerprint(block);
  if (block.type === "image") return { type: block.type, src: block.src, href: block.href, alt: block.alt, caption: block.caption ?? null, display: block.display ?? null };
  if (block.type === "rich") return { type: block.type, nodes: block.nodes.map(richNodeFingerprint) };
  return {
    type: block.type,
    template: block.template,
    system: block.system,
    title: block.title,
    fields: block.fields.map((field) => ({ key: field.key, label: field.label, value: field.value, content: field.content.map(blockFingerprint) })),
    resultLevel: block.resultLevel,
    resultLabel: block.resultLabel ?? null,
    fallbackText: block.fallbackText
  };
}

function canonicalFingerprint(document: LogEntryDocument) {
  return JSON.stringify({
    kind: document.kind,
    speaker: document.speaker?.name ?? null,
    projection: projectDocumentText(document),
    blocks: document.blocks.map(blockFingerprint)
  });
}

function compatibleTimestamp(left: LogEntryDocument, right: LogEntryDocument) {
  if (left.timestamp.iso && right.timestamp.iso) return left.timestamp.iso === right.timestamp.iso;
  if (left.timestamp.raw && right.timestamp.raw) return left.timestamp.raw === right.timestamp.raw;
  return false;
}

export function filterErrorDuplicates(documents: LogEntryDocument[]) {
  const kept: LogEntryDocument[] = [];
  const fingerprints = documents.map(canonicalFingerprint);
  let errorDuplicateCount = 0;
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const previous = kept.at(-1);
    const previousSourceIndex = index - 1;
    if (previous
      && previous.source.messageId !== document.source.messageId
      && compatibleTimestamp(previous, document)
      && previousSourceIndex >= 0
      && fingerprints[previousSourceIndex] === fingerprints[index]) {
      errorDuplicateCount += 1;
      continue;
    }
    kept.push(document);
  }
  return { documents: kept, errorDuplicateCount };
}
