import assert from "node:assert/strict";
import test from "node:test";
import { mergeCliSettings, modelLabel } from "./cli-settings.server.ts";

test("layers settings files with the later one winning", () => {
  const merged = mergeCliSettings([
    { effortLevel: "high", alwaysThinkingEnabled: true },
    { effortLevel: "max" },
    { alwaysThinkingEnabled: false },
  ]);
  assert.deepEqual(merged, { effortLevel: "max", thinking: false });
});

test("ignores files that are missing or malformed", () => {
  assert.deepEqual(mergeCliSettings([null, "nope", [], { effortLevel: 7 }]), {
    effortLevel: null,
    thinking: false,
  });
});

test("shortens model ids the way the CLI names them", () => {
  assert.equal(modelLabel("claude-opus-4-5-20251101"), "Opus 4.5");
  assert.equal(modelLabel("claude-sonnet-4-20250514"), "Sonnet 4");
  assert.equal(modelLabel("claude-3-5-sonnet-20241022"), "Sonnet 3.5");
  assert.equal(modelLabel("some-other-model"), "some-other-model");
  assert.equal(modelLabel(null), null);
});
