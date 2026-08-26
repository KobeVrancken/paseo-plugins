import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "./state.server.ts";

async function tempStore(): Promise<{ store: StateStore; cache: string }> {
  const cache = await mkdtemp(path.join(os.tmpdir(), "claude-plugin-cache-"));
  return { store: new StateStore({ XDG_CACHE_HOME: cache }), cache };
}

test("defaults to the CLI's own send behavior", async () => {
  const { store } = await tempStore();
  assert.equal((await store.settings()).sendBehavior, "cli_default");
});

test("persists settings and bindings across instances", async () => {
  const { store, cache } = await tempStore();
  await store.setSendBehavior("hold_until_idle");
  await store.bind("session-a", { terminalId: "term-1", workspaceDir: "/work", boundAt: 5 });

  const reloaded = new StateStore({ XDG_CACHE_HOME: cache });
  assert.equal((await reloaded.settings()).sendBehavior, "hold_until_idle");
  assert.deepEqual(await reloaded.binding("session-a"), {
    terminalId: "term-1",
    workspaceDir: "/work",
    boundAt: 5,
  });
});

test("writes state under the plugin's own cache directory", async () => {
  const { store, cache } = await tempStore();
  await store.setSendBehavior("interrupt_first");
  const raw = await readFile(
    path.join(cache, "paseo-plugins", "claude-code-panel", "state.json"),
    "utf8",
  );
  assert.match(raw, /interrupt_first/);
});

test("drops bindings whose terminal is gone", async () => {
  const { store } = await tempStore();
  await store.bind("alive", { terminalId: "term-1", workspaceDir: "/work", boundAt: 1 });
  await store.bind("dead", { terminalId: "term-2", workspaceDir: "/work", boundAt: 1 });
  assert.deepEqual(await store.pruneBindings(new Set(["term-1"])), ["dead"]);
  assert.equal(await store.binding("dead"), null);
  assert.notEqual(await store.binding("alive"), null);
});

test("falls back to defaults on a corrupt state file", async () => {
  const { store, cache } = await tempStore();
  await store.bind("a", { terminalId: "t", workspaceDir: "/w", boundAt: 1 });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(cache, "paseo-plugins", "claude-code-panel", "state.json"), "not json");
  const reloaded = new StateStore({ XDG_CACHE_HOME: cache });
  assert.deepEqual(await reloaded.bindings(), {});
  assert.equal((await reloaded.settings()).sendBehavior, "cli_default");
});
