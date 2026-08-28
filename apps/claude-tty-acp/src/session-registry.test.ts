import assert from "node:assert/strict";
import test from "node:test";
import { SessionRegistry } from "./session-registry.ts";

test("creates independent lazy sessions", () => {
  const registry = new SessionRegistry();
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
  assert.throws(() => new SessionRegistry().create("relative/path"), /absolute path/);
});

test("clears probe-only sessions without external state", () => {
  const registry = new SessionRegistry();
  registry.create("/work/probe");
  registry.clear();
  assert.equal(registry.size, 0);
});
