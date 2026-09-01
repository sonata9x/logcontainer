import assert from "node:assert/strict";
import test from "node:test";
import { previewSiblingResourceReorder } from "../lib/resources/reorder";

const pages = [
  { id: "a", order_index: 0, tree_parent_id: null, tree_relation: "workspace" as const },
  { id: "b", order_index: 10, tree_parent_id: null, tree_relation: "workspace" as const },
  { id: "c", order_index: 20, tree_parent_id: null, tree_relation: "workspace" as const },
  { id: "nested", order_index: 0, tree_parent_id: "folder", tree_relation: "workspace" as const }
];

test("sidebar preview reorders only siblings and compacts their order slots", () => {
  const result = previewSiblingResourceReorder(pages, ["b"], "c", "after");
  assert.ok(result);
  assert.deepEqual(result.pages.slice(0, 3).map((page) => [page.id, page.order_index]), [["a", 0], ["c", 1], ["b", 2]]);
  assert.deepEqual(result.before.map((page) => page.id), ["a", "b", "c"]);
  assert.deepEqual(result.ordered.map((page) => page.id), ["a", "c", "b"]);
  assert.equal(result.relation, "workspace");
  assert.equal(result.parentId, null);
});

test("sidebar preview never crosses personal or shared hierarchy boundaries", () => {
  assert.equal(previewSiblingResourceReorder(pages, ["nested"], "a", "before"), null);
  const shared = [
    { id: "x", order_index: 0, tree_parent_id: "shared", tree_relation: "folder" as const },
    { id: "y", order_index: 1, tree_parent_id: "shared", tree_relation: "folder" as const }
  ];
  const result = previewSiblingResourceReorder(shared, ["y"], "x", "before");
  assert.ok(result);
  assert.equal(result.relation, "folder");
  assert.equal(result.parentId, "shared");
});
