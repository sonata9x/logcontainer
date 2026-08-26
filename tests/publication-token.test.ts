import assert from "node:assert/strict";
import test from "node:test";
import { createPublicationToken } from "../lib/publication-token";

test("publication links use compact 12-character URL-safe tokens", () => {
  const tokens = new Set(Array.from({ length: 100 }, createPublicationToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{12}$/);
});
