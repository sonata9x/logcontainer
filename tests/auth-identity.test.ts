import assert from "node:assert/strict";
import test from "node:test";
import { deriveAuthPassword, isValidUsername, normalizeUsername } from "../lib/auth-identity";

test("usernames are normalized without requiring an email address", () => {
  assert.equal(normalizeUsername("  Sonata_9  "), "sonata_9");
  assert.equal(normalizeUsername("  소나타  "), "소나타");
  assert.equal(isValidUsername("소나타_9"), true);
  assert.equal(isValidUsername("한"), false);
  assert.equal(isValidUsername("bad name"), false);
});

test("four-character user passwords are expanded before Supabase Auth", () => {
  const derived = deriveAuthPassword("1234");
  assert.equal(derived.length, 64);
  assert.equal(derived, deriveAuthPassword("1234"));
  assert.notEqual(derived, deriveAuthPassword("1235"));
  assert.notEqual(derived, "1234");
});
