import assert from "node:assert/strict";
import test from "node:test";
import { isMuted, isPanelWatching, notificationTerminalId } from "./notifications.client.ts";

test("reads the terminal a notification is about", () => {
  assert.equal(notificationTerminalId({ title: "Terminal finished", data: { terminalId: "t1" } }), "t1");
  assert.equal(notificationTerminalId({ data: {} }), null);
  assert.equal(notificationTerminalId({}), null);
  assert.equal(notificationTerminalId(null), null);
});

test("mutes only the bound terminal, and only while the panel is watching", () => {
  const payload = { data: { terminalId: "t1" } };
  assert.equal(isMuted(payload, "t1", true), true);
  assert.equal(isMuted(payload, "t1", false), false);
  assert.equal(isMuted(payload, "t2", true), false);
  assert.equal(isMuted(payload, null, true), false);
  assert.equal(isMuted({ data: { agentId: "a1" } }, "t1", true), false);
});

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
