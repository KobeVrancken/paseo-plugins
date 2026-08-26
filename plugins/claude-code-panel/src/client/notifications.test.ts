import assert from "node:assert/strict";
import test from "node:test";
import { isPanelWatching } from "./notifications.client.ts";

test("counts the panel as watching only when the window and the node are both up", () => {
  const laidOut = { getClientRects: () => ({ length: 1 }) };
  const hidden = { getClientRects: () => ({ length: 0 }) };
  const host = globalThis as { document?: unknown };
  const original = host.document;
  try {
    host.document = { visibilityState: "visible", hasFocus: () => true };
    assert.equal(isPanelWatching(laidOut), true);
    assert.equal(isPanelWatching(hidden), false);
    assert.equal(isPanelWatching(null), false);

    host.document = { visibilityState: "visible", hasFocus: () => false };
    assert.equal(isPanelWatching(laidOut), false);

    host.document = { visibilityState: "hidden", hasFocus: () => true };
    assert.equal(isPanelWatching(laidOut), false);
  } finally {
    host.document = original;
  }
});
