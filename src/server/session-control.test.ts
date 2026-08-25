import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeClaudeSession } from "./capture.server.ts";
import { resolvePaseoBinary } from "./paseo-cli.server.ts";

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
