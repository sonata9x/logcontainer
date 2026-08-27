import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: tsx scripts/inspect-roll20-v2.ts <roll20.html>");
const source = readFileSync(resolve(sourcePath), "utf8");
const result = importRoll20HtmlV2(source, { removeHiddenMessages: true });
const blocks = result.documents.flatMap((document) => document.blocks);
const rich = blocks.filter((block) => block.type === "rich");
const templates = blocks.filter((block) => block.type === "roll-template");

console.log(JSON.stringify({
  report: result.report,
  documents: result.documents.length,
  blocks: Object.fromEntries([...new Set(blocks.map((block) => block.type))].map((type) => [type, blocks.filter((block) => block.type === type).length])),
  richBlocks: rich.length,
  richNodes: rich.reduce((count, block) => count + block.nodes.length, 0),
  templates: Object.fromEntries([...new Set(templates.map((template) => template.template ?? "unknown"))].map((name) => [name, templates.filter((template) => (template.template ?? "unknown") === name).length]))
}, null, 2));
