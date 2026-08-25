import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeClaudeSession } from "./capture.server.ts";
import { composePrompt } from "./session-control.server.ts";
import { resolvePaseoBinary } from "./paseo-cli.server.ts";

test("normalizes newlines and trims the prompt", () => {
  assert.equal(composePrompt("  hello\r\nworld  ", []), "hello\nworld");
});

test("appends every attachment on a line of its own", () => {
  assert.equal(
    composePrompt("look at this", ["/cache/a.png", "https://example.test/pull/3"]),
    "look at this\n/cache/a.png\nhttps://example.test/pull/3",
  );
});

test("sends an attachment without text", () => {
  assert.equal(composePrompt("", ["/cache/a.png"]), "/cache/a.png");
});

test("recognises an interactive Claude Code screen", () => {
  assert.equal(
    looksLikeClaudeSession(["  Opus 5 (1M context) · main · 16k/1.0M tokens (2%)", "  ⏵⏵ auto mode on"]),
    true,
  );
  assert.equal(looksLikeClaudeSession(["~/work main", "❯ ls -la"]), false);
});

test("prefers an explicit PASEO_BIN", () => {
  assert.equal(resolvePaseoBinary({ PASEO_BIN: "/custom/paseo" }), "/custom/paseo");
});
