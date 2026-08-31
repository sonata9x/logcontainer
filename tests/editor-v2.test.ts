import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendBlock, cloneLogDocument, duplicateBlock, editorTextToStyle, moveBlock, removeBlock, replaceBlock } from "../lib/logs/model/editor";
import { projectDocumentText } from "../lib/logs/model/projection";
import { applyEditableTextChanges, applyRichStyleChanges, editableTextSegments, styledContentTargets } from "../lib/logs/model/user-edit";
import { sanitizeRichStyle } from "../lib/logs/rich/style";
import { validateLogEntryDocument } from "../lib/logs/model/validate";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";
import { createManualStyledLogEntryDocument } from "../lib/logs/model/factory";

const fixture = readFileSync(new URL("./fixtures/roll20/real-msgdata-anonymized.html", import.meta.url), "utf8");
const topologyFixture = readFileSync(new URL("./fixtures/roll20/rendered-topology-v2.html", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
const inlineEditorSource = readFileSync(new URL("../components/logs/InlineContentEditor.tsx", import.meta.url), "utf8");
const contextMenuSource = readFileSync(new URL("../components/logs/EntryContextMenu.tsx", import.meta.url), "utf8");
const updateRoute = readFileSync(new URL("../app/api/pages/[id]/entries/[entryId]/route.ts", import.meta.url), "utf8");

test("text-only v2 editing changes the document and projected content without mutating the original", () => {
  const original = importRoll20HtmlV2(fixture).documents[0];
  const draft = cloneLogDocument(original);
  const edited = replaceBlock(draft, 0, { ...draft.blocks[0], type: "text", text: "수정된 문장" });
  assert.notEqual(edited, original);
  assert.notEqual(projectDocumentText(edited), projectDocumentText(original));
  assert.equal(projectDocumentText(edited), "수정된 문장");
  assert.equal(projectDocumentText(original), "익명화된 실제 대화");
});

test("block operations preserve order and assign fresh ids to duplicates", () => {
  const original = importRoll20HtmlV2(fixture).documents[2];
  const duplicated = duplicateBlock(original, 1);
  assert.deepEqual(duplicated.blocks.map((block) => block.type), ["text", "inline-roll", "inline-roll", "text"]);
  assert.notEqual(duplicated.blocks[1].id, duplicated.blocks[2].id);
  const moved = moveBlock(duplicated, 2, 1);
  assert.deepEqual(moved.blocks.map((block) => block.type), ["text", "inline-roll", "text", "inline-roll"]);
  const removed = removeBlock(moved, 3);
  assert.deepEqual(removed.blocks.map((block) => block.type), ["text", "inline-roll", "text"]);
  assert.deepEqual(original.blocks.map((block) => block.type), ["text", "inline-roll", "text"]);
});

test("Rich CSS editor output uses the common document sanitizer on save", () => {
  const document = appendBlock(importRoll20HtmlV2(fixture).documents[0], "rich");
  const rich = document.blocks.at(-1)!;
  assert.equal(rich.type, "rich");
  if (rich.type !== "rich" || rich.nodes[0].type !== "element") return;
  rich.nodes[0].style = editorTextToStyle("color: #fff; position: fixed; background-color: #c2200e;");
  const validated = validateLogEntryDocument(document);
  assert.ok(validated.ok);
  const validatedRich = validated.document.blocks.at(-1)!;
  assert.equal(validatedRich.type, "rich");
  if (validatedRich.type !== "rich" || validatedRich.nodes[0].type !== "element") return;
  assert.deepEqual(validatedRich.nodes[0].style, [{ property: "color", value: "#fff" }, { property: "background-color", value: "#c2200e" }]);
});

test("inline content edits preserve Rich CSS and all message metadata", () => {
  const original = importRoll20HtmlV2(topologyFixture).documents.find((document) => document.source.messageId === "rich-flow-1")!;
  const segment = editableTextSegments(original)[0];
  const styles = styledContentTargets(original);
  const edited = applyEditableTextChanges(original, [{ id: segment.id, text: "바뀐 표시 텍스트" }]);
  assert.equal(editableTextSegments(edited)[0].text, "바뀐 표시 텍스트");
  assert.deepEqual(styledContentTargets(edited).map(({ id, style }) => ({ id, style })), styles.map(({ id, style }) => ({ id, style })));
  assert.deepEqual(edited.speaker, original.speaker);
  assert.deepEqual(edited.timestamp, original.timestamp);
  assert.deepEqual(edited.presentation, original.presentation);
});

test("Content CSS accepts Roll20-style strings and changes only an existing styled target", () => {
  const original = importRoll20HtmlV2(topologyFixture).documents.find((document) => document.source.messageId === "rich-flow-1")!;
  const targets = styledContentTargets(original);
  assert.deepEqual(targets.map((target) => target.label), ["KPC", "주예담", "PC", "진희령"]);
  const target = targets[0];
  assert.ok(target);
  const sanitized = sanitizeRichStyle("font-size: 12pt; position: absolute; width: 100%; top: 6px; left: 0px; display: block; text-decoration: none; color: #c2200e; background-image: linear-gradient(135deg, #C2200E, #1F1E20);");
  assert.equal(sanitized.droppedCount, 0);
  const edited = applyRichStyleChanges(original, [{ id: target.id, style: sanitized.style }]);
  assert.deepEqual(styledContentTargets(edited).find((item) => item.id === target.id)?.style, sanitized.style);
  assert.deepEqual(edited.speaker, original.speaker);
  assert.deepEqual(edited.blocks.map((block) => block.type), original.blocks.map((block) => block.type));
});

test("v2 user UI exposes inline editing and the restored block action menu", () => {
  assert.match(editorSource, /<InlineContentEditor/);
  assert.match(editorSource, /<EntryContextMenu/);
  assert.doesNotMatch(editorSource, /V2LogEntryEditor|v2-add-block|화자 색|아바타 URL|결과 상태/);
  assert.match(editorSource, /className="entry-more"/);
  assert.match(editorSource, /<EllipsisVertical/);
  assert.match(editorSource, /<InlineAddForm/);
  assert.match(inlineEditorSource, /r20-editable-text/);
  assert.match(contextMenuSource, /아래에 로그 블록 추가/);
  assert.match(contextMenuSource, /CSS 수정/);
  assert.match(contextMenuSource, /수정 이력/);
  assert.match(contextMenuSource, /원본 상태로 복원/);
  assert.match(contextMenuSource, /삭제/);
  assert.match(contextMenuSource, /createPortal\(menu, document\.body\)/);
  assert.match(editorSource, /createPortal\(children, document\.body\)/);
  assert.match(editorSource, /entryType === "dialogue"/);
  assert.match(updateRoute, /contentEdits/);
  assert.match(updateRoute, /styleEdits/);
  assert.match(updateRoute, /styledContentTargets\(targetDocument\)/);
  assert.match(updateRoute, /restoreOriginal/);
  assert.match(updateRoute, /entry\.original_document/);
  assert.match(updateRoute, /revisionAction = "restore"/);
  assert.match(updateRoute, /revisionId/);
  assert.match(updateRoute, /entry\.original_document \?\? entry\.document/);
  assert.match(updateRoute, /update_log_entry_document_v3/);
});

test("manual blocks can contain multiple independently styled inline segments", () => {
  const document = createManualStyledLogEntryDocument("dialogue", "테스터", [
    { text: "빨강", style: [{ property: "color", value: "#c2200e" }] },
    { text: "굵게", style: [{ property: "font-weight", value: "700" }] }
  ]);
  assert.equal(projectDocumentText(document), "빨강굵게");
  assert.deepEqual(styledContentTargets(document).map((target) => target.label), ["빨강", "굵게"]);
  assert.equal(document.blocks[0].type, "rich");
});
