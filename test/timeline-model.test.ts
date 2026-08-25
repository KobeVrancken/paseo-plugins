import assert from "node:assert/strict";
import test from "node:test";
import type { RenderEntry } from "../render-types.shared.ts";
import { groupEntries } from "../timeline-model.client.ts";

function entry(index: number, isSidechain: boolean): RenderEntry {
  return {
    index,
    id: `e${index}`,
    ts: null,
    isSidechain,
    body: { kind: "user_text", text: `entry ${index}` },
  };
}

test("groups consecutive sidechain entries into one card", () => {
  const items = groupEntries([entry(0, false), entry(1, true), entry(2, true), entry(3, false)]);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["entry", "sidechain", "entry"],
  );
  assert.equal(items[1]!.kind === "sidechain" && items[1]!.entries.length, 2);
});

test("keeps separate sidechain runs apart", () => {
  const items = groupEntries([entry(0, true), entry(1, false), entry(2, true)]);
  assert.deepEqual(items.map((item) => item.kind), ["sidechain", "entry", "sidechain"]);
});

test("passes a plain timeline through unchanged", () => {
  const items = groupEntries([entry(0, false), entry(1, false)]);
  assert.deepEqual(items.map((item) => item.key), ["0:e0", "1:e1"]);
});
