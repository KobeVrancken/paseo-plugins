import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  IDLE_TIMEOUT_ENV,
  MAX_IDLE_TIMEOUT_MS,
  idleTimeoutFromEnv,
  parseIdleTimeout,
  readIdleTimeout,
  settingsFilePath,
} from "./idle-timeout.ts";

async function withSettingsFile(contents: string | null, run: (env: Record<string, string>) => Promise<void>): Promise<void> {
  const cache = await mkdtemp(path.join(os.tmpdir(), "claude-tty-idle-"));
  const env = { XDG_CACHE_HOME: cache, HOME: cache };
  try {
    if (contents !== null) {
      const target = settingsFilePath(env);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    await run(env);
  } finally {
    await rm(cache, { force: true, recursive: true });
  }
}

test("takes decimal integers in range and nothing else", () => {
  assert.equal(parseIdleTimeout("900000"), 900_000);
  assert.equal(parseIdleTimeout(" 0 "), 0);
  assert.equal(parseIdleTimeout(900_000), 900_000);
  assert.equal(parseIdleTimeout(String(MAX_IDLE_TIMEOUT_MS)), MAX_IDLE_TIMEOUT_MS);
  for (const rejected of ["soon", "-1", "1.5", "0x1c", "1e3", "", String(MAX_IDLE_TIMEOUT_MS + 1), null, true]) {
    assert.equal(parseIdleTimeout(rejected), null, `expected ${String(rejected)} to be rejected`);
  }
});

test("reports a malformed environment value instead of failing the process over it", () => {
  assert.equal(idleTimeoutFromEnv({}), null);
  assert.equal(idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "900000" }), 900_000);
  assert.equal(idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "0" }), 0);
  assert.equal(idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "soon" }), null);
  assert.equal(idleTimeoutFromEnv({ [IDLE_TIMEOUT_ENV]: "2147483648" }), null);
});

test("defaults idle suspension to one hour when nothing configures it", async () => {
  await withSettingsFile(null, async (env) => {
    assert.equal(await readIdleTimeout(env), DEFAULT_IDLE_TIMEOUT_MS);
  });
});

test("reads the timeout the plugin saved, including a zero that disables suspension", async () => {
  await withSettingsFile(JSON.stringify({ version: 1, settings: { idleTimeoutMs: 900_000 } }), async (env) => {
    assert.equal(await readIdleTimeout(env), 900_000);
  });
  await withSettingsFile(JSON.stringify({ version: 1, settings: { idleTimeoutMs: 0 } }), async (env) => {
    assert.equal(await readIdleTimeout(env), 0);
  });
});

test("lets the environment variable override the saved setting", async () => {
  await withSettingsFile(JSON.stringify({ version: 1, settings: { idleTimeoutMs: 900_000 } }), async (env) => {
    assert.equal(await readIdleTimeout({ ...env, [IDLE_TIMEOUT_ENV]: "60000" }), 60_000);
  });
});

test("falls back to the default for a settings file it cannot use", async () => {
  const unusable = ["not json", JSON.stringify({ version: 1 }), JSON.stringify({ version: 1, settings: { idleTimeoutMs: "soon" } })];
  for (const contents of unusable) {
    await withSettingsFile(contents, async (env) => {
      assert.equal(await readIdleTimeout(env), DEFAULT_IDLE_TIMEOUT_MS);
    });
  }
});
