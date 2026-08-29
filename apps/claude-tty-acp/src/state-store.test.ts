import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore, type PersistedSession } from "./state-store.ts";

const SESSION_ID = "55555555-5555-4555-8555-555555555555";

test("atomically persists and loads host-local session state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "state-store-test-"));
  const store = new StateStore(root);
  const state: PersistedSession = {
    version: 1,
    acpSessionId: SESSION_ID,
    claudeSessionId: "66666666-6666-4666-8666-666666666666",
    cwd: "/work/repo",
    model: "sonnet",
    mode: "plan",
    lastActivity: 123,
  };

  try {
    assert.equal(await store.load(SESSION_ID), null);
    await store.save(state);
    assert.deepEqual(await store.load(SESSION_ID), state);
    assert.match(await readFile(store.sessionPath(SESSION_ID), "utf8"), /"claudeSessionId"/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects corrupt state and unsafe session IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "state-store-test-"));
  const store = new StateStore(root);
  try {
    await assert.rejects(store.load("../../escape"), /Invalid ACP session ID/);
    await store.save({
      version: 1,
      acpSessionId: SESSION_ID,
      claudeSessionId: SESSION_ID,
      cwd: "/work/repo",
      model: "inherit",
      mode: "default",
      lastActivity: 1,
    });
    await writeFile(store.sessionPath(SESSION_ID), "{}\n");
    await assert.rejects(store.load(SESSION_ID), /is invalid/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
