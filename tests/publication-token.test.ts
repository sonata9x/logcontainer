import assert from "node:assert/strict";
import test from "node:test";
import { createPublicationToken, publicationTokenForConfiguration } from "../lib/publication-token";

test("publication links use compact 12-character URL-safe tokens", () => {
  const tokens = new Set(Array.from({ length: 100 }, createPublicationToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{12}$/);
});

test("active publication settings retain their link while restarting rotates it", () => {
  const current = "AbCdEf123_-x";
  assert.equal(publicationTokenForConfiguration({ token: current, is_active: true }, () => "newtoken1234"), current);
  assert.equal(publicationTokenForConfiguration({ token: current, is_active: false }, () => "newtoken1234"), "newtoken1234");
  assert.equal(publicationTokenForConfiguration(null, () => "newtoken1234"), "newtoken1234");
  assert.equal(publicationTokenForConfiguration({ token: "invalid", is_active: true }, () => "newtoken1234"), "newtoken1234");
});
