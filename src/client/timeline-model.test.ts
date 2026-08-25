import assert from "node:assert/strict";
import test from "node:test";
import type { RenderEntry } from "../render-types.shared.ts";
import { groupEntries, reconcilePending, type PendingPrompt } from "./timeline-model.client.ts";

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

function assistant(index: number): RenderEntry {
  return {
    index,
    id: `a${index}`,
    ts: null,
    isSidechain: false,
    body: { kind: "assistant_markdown", text: "hi" },
  };
}

function prompt(id: string, afterIndex: number): PendingPrompt {
  return { id, text: `prompt ${id}`, afterIndex };
}

test("keeps an echo until a user line lands after it", () => {
  const pending = [prompt("a", 2)];
  assert.equal(reconcilePending(pending, [entry(0, false), entry(1, false)]).length, 1);
  assert.equal(reconcilePending(pending, [entry(0, false), assistant(2)]).length, 1);
  assert.equal(reconcilePending(pending, [entry(0, false), entry(2, false)]).length, 0);
});

test("takes one echo per user line, in the order they were sent", () => {
  const pending = [prompt("a", 2), prompt("b", 2)];
  assert.deepEqual(
    reconcilePending(pending, [entry(2, false)]).map((item) => item.id),
    ["b"],
  );
  assert.equal(reconcilePending(pending, [entry(2, false), entry(3, false)]).length, 0);
});

test("ignores a subagent prompt", () => {
  const pending = [prompt("a", 2)];
  assert.equal(reconcilePending(pending, [entry(2, true)]).length, 1);
});

test("leaves the list alone when nothing has arrived", () => {
  const pending = [prompt("a", 2)];
  assert.equal(reconcilePending(pending, []), pending);
  assert.equal(reconcilePending([], [entry(2, false)]).length, 0);
});
