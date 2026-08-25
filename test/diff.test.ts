import assert from "node:assert/strict";
import test from "node:test";
import { diffLines, trimDiffContext } from "../diff.server.ts";

test("keeps unchanged lines as context", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nB\nc"), [
    { kind: "ctx", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "ctx", text: "c" },
  ]);
});

test("handles pure insertions and deletions", () => {
  assert.deepEqual(diffLines("", "new"), [{ kind: "add", text: "new" }]);
  assert.deepEqual(diffLines("gone", ""), [{ kind: "del", text: "gone" }]);
});

test("collapses long unchanged runs", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 10", "line ten");
  const trimmed = trimDiffContext(diffLines(before, after));
  assert.ok(trimmed.some((line) => line.text.includes("unchanged lines")));
  assert.ok(trimmed.length < 20);
  assert.ok(trimmed.some((line) => line.kind === "add" && line.text === "line ten"));
});
