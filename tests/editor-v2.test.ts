import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendBlock, cloneLogDocument, duplicateBlock, editorTextToStyle, moveBlock, removeBlock, replaceBlock } from "../lib/logs/model/editor";
import { projectDocumentText } from "../lib/logs/model/projection";
import { validateLogEntryDocument } from "../lib/logs/model/validate";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const fixture = readFileSync(new URL("./fixtures/roll20/real-msgdata-anonymized.html", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
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

test("v2 entries use document PATCH and snapshot revision restore instead of readonly content editing", () => {
  assert.doesNotMatch(editorSource, /구조화된 v2 로그|v2-readonly-note|document_version === 2\) return/);
  assert.match(editorSource, /document: revision\.previous_snapshot/);
  assert.match(editorSource, /<V2LogEntryEditor/);
  assert.match(updateRoute, /validateLogEntryDocument\(body\.document\)/);
  assert.match(updateRoute, /update_log_entry_document_v2/);
});
