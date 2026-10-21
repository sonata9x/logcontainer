import { sanitizeLogHtml } from "@/lib/logs/html";
import { isCompactEntrySpacing } from "@/lib/logs/entry-spacing";
import { isStoredLogEntryDocumentV2 } from "@/lib/logs/model/validate";
import type { InlineRollBlock, LogBlock, LogEntryDocument, RichNode, RichStyle, RollTemplateBlock, RollTemplateField } from "@/lib/logs/model/types";
import { resolveEntryAvatar } from "@/lib/speaker-avatars";
import type { ExternalExportEntry } from "@/lib/external-export/types";
import type { LogEntry, SpeakerAvatarBundle } from "@/lib/types";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function attribute(value: string | null | undefined) {
  return value ? escapeHtml(value) : "";
}

function styleText(style: RichStyle) {
  return style.map((item) => `${item.property}:${item.value}`).join(";");
}

function styleValue(style: RichStyle, property: string) {
  return [...style].reverse().find((item) => item.property === property)?.value.trim().toLowerCase();
}

const BLOCK_FLOW_DISPLAYS = new Set(["block", "flex", "grid", "table", "table-row", "table-cell"]);
function styleNeedsBlockFlow(style: RichStyle) {
  return BLOCK_FLOW_DISPLAYS.has(styleValue(style, "display") ?? "") || styleValue(style, "position") === "absolute";
}

function isCentered(style: RichStyle) {
  return styleValue(style, "text-align") === "center";
}

function trimPresentationBoundaries(nodes: RichNode[]) {
  const next = [...nodes];
  while (next[0]?.type === "text" && /^\s+$/.test(next[0].text)) next.shift();
  while (next.at(-1)?.type === "text" && /^\s+$/.test((next.at(-1) as Extract<RichNode, { type: "text" }>).text)) next.pop();
  return next;
}

function inlineRoll(roll: InlineRollBlock) {
  const title = roll.tooltip ?? roll.expression;
  return `<span class="r20-inline-roll r20-inline-roll--${attribute(roll.state ?? "normal")}"${title ? ` title="${attribute(title)}"` : ""}>${escapeHtml(roll.value)}</span>`;
}

function richNode(node: RichNode, root = false): string {
  if (node.type === "text") return escapeHtml(node.text);
  if (node.type === "break") return "<br>";
  if (node.type === "inline-roll") return inlineRoll(node.roll);
  if (node.type === "image") {
    const image = `<img class="r20-rich-image" src="${attribute(node.src)}" alt="${attribute(node.alt)}"${node.style.length ? ` style="${attribute(styleText(node.style))}"` : ""} loading="lazy" referrerpolicy="no-referrer">`;
    return node.href ? `<a href="${attribute(node.href)}" target="_blank" rel="noopener noreferrer">${image}</a>` : image;
  }
  const sourceChildren = root && (isCentered(node.style) || styleNeedsBlockFlow(node.style)) ? trimPresentationBoundaries(node.children) : node.children;
  const className = root && isCentered(node.style) ? " class=\"r20-rich-root--centered\"" : "";
  const style = node.style.length ? ` style="${attribute(styleText(node.style))}"` : "";
  const title = node.title ? ` title="${attribute(node.title)}"` : "";
  const href = node.tag === "a" && node.href ? ` href="${attribute(node.href)}" target="_blank" rel="noopener noreferrer"` : "";
  return `<${node.tag}${className}${style}${title}${href}>${sourceChildren.map((child) => richNode(child)).join("")}</${node.tag}>`;
}

function richNeedsBlockFlow(nodes: RichNode[]): boolean {
  return nodes.some((node) => node.type === "element" && (["div", "p", "blockquote", "pre"].includes(node.tag) || styleNeedsBlockFlow(node.style) || richNeedsBlockFlow(node.children)));
}

function richBlock(block: Extract<LogBlock, { type: "rich" }>) {
  const content = block.nodes.filter((node) => !(node.type === "element" && node.tag === "div" && !node.style.length && !node.children.length && !node.href && !node.title));
  const blockFlow = richNeedsBlockFlow(content);
  const tag = blockFlow ? "div" : "span";
  const nodes = content.length !== block.nodes.length || blockFlow || content.some((node) => node.type === "element" && isCentered(node.style)) ? trimPresentationBoundaries(content) : content;
  return `<${tag} class="log-rich-context r20-rich-context ${blockFlow ? "r20-rich-context--block" : "r20-rich-context--inline"}">${nodes.map((node) => richNode(node, true)).join("")}</${tag}>`;
}

function localizedResultLabel(level: RollTemplateBlock["resultLevel"]) {
  return level ? ({ critical: "대성공", extreme: "극단적 성공", hard: "어려운 성공", success: "성공", failure: "실패", fumble: "대실패" } as const)[level] : null;
}

function fieldValue(field: RollTemplateField) {
  return field.content.length ? field.content.map((part) => part.type === "text" ? escapeHtml(part.text) : inlineRoll(part)).join("") : escapeHtml(field.value);
}

function templateRows(block: RollTemplateBlock) {
  if (block.system !== "coc7") return block.fields.map((field) => ({ key: field.id, label: field.label, value: fieldValue(field), result: field.key === "result" }));
  const semantic = Object.fromEntries(block.fields.map((field) => [field.key, field]));
  const consumed = new Set(["target", "hard", "extreme", "rolled", "result"]);
  const rows: Array<{ key: string; label: string; value: string; result?: boolean }> = [];
  if (semantic.target || semantic.hard || semantic.extreme) rows.push({ key: "thresholds", label: "기준치", value: escapeHtml([semantic.target?.value, semantic.hard?.value, semantic.extreme?.value].filter(Boolean).join(" / ")) });
  if (semantic.rolled) rows.push({ key: "rolled", label: "굴림", value: fieldValue(semantic.rolled) });
  const resultLabel = block.resultLabel || semantic.result?.value || localizedResultLabel(block.resultLevel);
  if (resultLabel) rows.push({ key: "result", label: "판정결과", value: escapeHtml(resultLabel), result: true });
  for (const field of block.fields) if (!consumed.has(field.key)) rows.push({ key: field.id, label: field.label, value: fieldValue(field) });
  return rows;
}

function blockHtml(block: LogBlock, speakerTemplate = false) {
  if (block.type === "text") return `<span class="r20-text">${escapeHtml(block.text)}</span>`;
  if (block.type === "inline-roll") return inlineRoll(block);
  if (block.type === "rich") return richBlock(block);
  if (block.type === "image") {
    const declarations = [["width", block.display?.width], ["height", block.display?.height], ["min-width", block.display?.minWidth], ["max-width", block.display?.maxWidth]].filter((item): item is [string, string] => Boolean(item[1])).map(([key, value]) => `${key}:${value}`).join(";");
    const image = `<img class="r20-image" src="${attribute(block.src)}" alt="${attribute(block.alt)}"${declarations ? ` style="${attribute(declarations)}"` : ""} loading="lazy" referrerpolicy="no-referrer">`;
    const linked = block.href ? `<a href="${attribute(block.href)}" target="_blank" rel="noopener noreferrer">${image}</a>` : image;
    return `<figure class="r20-image-block r20-image-block--${attribute(block.display?.align ?? "default")}">${linked}${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
  }
  const rows = templateRows(block);
  const resultLabel = block.resultLabel || localizedResultLabel(block.resultLevel);
  return `<section class="r20-template r20-template--${attribute(block.resultLevel ?? "normal")}${speakerTemplate ? " r20-template--speaker-inline" : ""}"><table class="r20-template__table">${block.title ? `<caption>${escapeHtml(block.title)}</caption>` : ""}<tbody>${rows.map((row) => `<tr class="r20-template__field${row.result ? " r20-template__field--result" : ""}"><td class="r20-template__label">${escapeHtml(row.label)}${/[：:]$/.test(row.label) ? "" : ":"}</td><td class="r20-template__value${row.result && block.resultLevel ? ` r20-template__value--${attribute(block.resultLevel)}` : ""}">${row.value}</td></tr>`).join("")}</tbody></table>${!rows.some((row) => row.result) && resultLabel ? `<div class="r20-template__result">${escapeHtml(resultLabel)}</div>` : ""}</section>`;
}

function documentHtml(document: LogEntryDocument, avatarCandidates: string[], managedAvatar: boolean) {
  const presentation = document.presentation ?? { speakerExplicit: Boolean(document.speaker?.name), avatarExplicit: Boolean(document.speaker?.avatarUrl), timestampExplicit: Boolean(document.timestamp.raw), continuation: false };
  const showSpeaker = document.kind === "dialogue" && presentation.speakerExplicit && Boolean(document.speaker?.name);
  const candidates = avatarCandidates.length ? avatarCandidates : document.speaker?.avatarUrl ? [document.speaker.avatarUrl] : [];
  const showAvatar = document.kind === "dialogue" && Boolean(candidates.length) && (managedAvatar ? presentation.speakerExplicit : presentation.avatarExplicit);
  const showTimestamp = presentation.timestampExplicit && Boolean(document.timestamp.raw);
  const speakerTemplate = showSpeaker && document.blocks.length === 1 && document.blocks[0].type === "roll-template";
  const speakerImage = showSpeaker && document.blocks.length === 1 && document.blocks[0].type === "image";
  const avatar = showAvatar ? `<img class="r20-message__avatar" src="${attribute(candidates[0])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
  const timestamp = showTimestamp ? `<time class="r20-message__timestamp"${document.timestamp.iso ? ` datetime="${attribute(document.timestamp.iso)}"` : ""}>${escapeHtml(document.timestamp.raw!)}</time>` : "";
  const flowClass = `r20-message__content-flow${speakerTemplate ? " r20-message__content-flow--speaker-template" : ""}${speakerImage ? " r20-message__content-flow--speaker-image" : ""}`;
  return `<article class="r20-message r20-message--${document.kind}${presentation.continuation ? " r20-message--continuation" : ""}">${document.kind === "dialogue" ? `<div class="r20-message__avatar-slot">${avatar}</div>` : ""}<div class="r20-message__body">${timestamp}<div class="${flowClass}">${showSpeaker ? `<strong class="r20-message__speaker">${escapeHtml(document.speaker!.name!)}:</strong>` : ""}${document.blocks.map((block) => blockHtml(block, speakerTemplate)).join("")}</div></div></article>`;
}

function entryHtml(entry: LogEntry, avatars: SpeakerAvatarBundle | null) {
  if (entry.document_version === 2 && isStoredLogEntryDocumentV2(entry.document)) {
    const avatar = resolveEntryAvatar(entry, avatars);
    return `<div class="log-entry log-entry-v2">${documentHtml(entry.document, avatar.candidates, avatar.managed)}</div>`;
  }
  if (entry.raw_html) return `<div class="log-entry">${sanitizeLogHtml(entry.raw_html)}</div>`;
  return `<article class="log-entry entry-${attribute(entry.entry_type)}">${entry.speaker_name ? `<div class="log-entry-speaker"${entry.speaker_color ? ` style="color:${attribute(entry.speaker_color)}"` : ""}>${escapeHtml(entry.speaker_name)}</div>` : ""}<div class="log-entry-content">${escapeHtml(entry.content)}</div></article>`;
}

export function exportEntryKey(entryId: string) {
  return `entry-${entryId}`;
}

export function safeExportName(value: string, fallback = "session-log") {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100) || fallback;
}

export function safeAssetExtension(value: string | null | undefined, fallback: string) {
  const extension = value?.toLowerCase().match(/\.([a-z0-9]{1,5})(?:$|[?#])/)?.[1];
  return extension && ["png", "jpg", "jpeg", "gif", "webp", "mp3"].includes(extension) ? extension : fallback;
}

export function assetExtensionForMime(value: string | null | undefined, fallback = "bin") {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "audio/mpeg": "mp3" } as Record<string, string>)[value ?? ""] ?? fallback;
}

export function renderExternalEntries(entries: LogEntry[], avatars: SpeakerAvatarBundle | null, previous?: LogEntry): ExternalExportEntry[] {
  return entries.map((entry, index) => ({
    key: exportEntryKey(entry.id),
    compactSpacing: isCompactEntrySpacing(entry, index > 0 ? entries[index - 1] : previous),
    html: entryHtml(entry, avatars),
    stream: entry.document_version === 2 && entry.document?.source.stream?.id === "casual" ? "casual" : "main"
  }));
}
