import assert from "node:assert/strict";
import test from "node:test";
import { buildNewEntryHtml, replaceTextPreservingMarkup, sanitizeLogHtml } from "../lib/logs/html";

test("editing replaces the final visible text node while preserving Roll20 markup", () => {
  const source = '<div class="message general"><strong class="by">GM:</strong><span class="content"><em>기존</em> 문장</span></div>';
  const result = replaceTextPreservingMarkup(source, "수정한 문장") ?? "";
  assert.match(result, /class="message general"/);
  assert.match(result, /<strong class="by">GM:<\/strong>/);
  assert.match(result, /<em>기존<\/em>수정한 문장/);
});

test("sanitizer removes executable markup and keeps safe Roll20 presentation", () => {
  const source = '<script>alert(1)</script><div class="message" style="color:#123456;position:fixed" onclick="alert(1)"><a href="javascript:alert(1)">링크</a><figure><img src="https://example.com/a.png" onerror="alert(1)"><figcaption>그림</figcaption></figure></div>';
  const result = sanitizeLogHtml(source);
  assert.doesNotMatch(result, /script|onclick|onerror|javascript|position/i);
  assert.match(result, /color:#123456/);
  assert.match(result, /<figure>/);
});

test("new dialogue blocks escape user-authored markup", () => {
  const result = buildNewEntryHtml("dialogue", '<img src=x onerror="x">', "<script>x</script>");
  assert.doesNotMatch(result, /<script>|<img/);
  assert.match(result, /&lt;script&gt;x&lt;\/script&gt;/);
});
