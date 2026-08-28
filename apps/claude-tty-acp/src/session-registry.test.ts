import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { HookServer } from "./hook-server.ts";
import { SessionRegistry } from "./session-registry.ts";

function createRegistry(): SessionRegistry {
  return new SessionRegistry({} as AgentSideConnection, new HookServer());
}

test("creates independent lazy sessions", () => {
  const registry = createRegistry();
  const first = registry.create("/work/one");
  const second = registry.create("/work/two");

  assert.notEqual(first.id, second.id);
  assert.equal(first.started, false);
  assert.equal(second.started, false);
  assert.equal(registry.size, 2);
  assert.equal(registry.get(first.id)?.cwd, "/work/one");
  assert.equal(registry.get(second.id)?.cwd, "/work/two");
});

test("rejects relative session directories", () => {
  assert.throws(() => createRegistry().create("relative/path"), /absolute path/);
});

test("clears probe-only sessions without external state", async () => {
  const registry = createRegistry();
  registry.create("/work/probe");
  await registry.clear();
  assert.equal(registry.size, 0);
});
