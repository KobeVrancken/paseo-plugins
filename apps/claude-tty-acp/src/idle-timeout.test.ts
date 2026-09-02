import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_IDLE_TIMEOUT_MS, IDLE_TIMEOUT_ENV, idleTimeoutFromEnv } from "./idle-timeout.ts";

test("defaults idle suspension to one hour", () => {
  assert.equal(idleTimeoutFromEnv({}), DEFAULT_IDLE_TIMEOUT_MS);
});

test("reads an explicit timeout and allows disabling suspension", () => {
  assert.equal(idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "900000" }), 900_000);
  assert.equal(idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "0" }), 0);
});

test("rejects invalid idle timeouts", () => {
  assert.throws(() => idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "soon" }), /integer from 0/);
  assert.throws(() => idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "-1" }), /integer from 0/);
  assert.throws(() => idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "1.5" }), /integer from 0/);
  assert.throws(() => idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "2147483648" }), /integer from 0/);
});
