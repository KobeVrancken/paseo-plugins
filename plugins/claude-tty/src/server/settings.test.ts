import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { PaseoApi } from "@getpaseo/client";
import { PROVIDER_ID, providerEntryFor, type ProviderEntry } from "../provider.shared.ts";
import { IDLE_TIMEOUT_ENV } from "../settings.shared.ts";
import { updateSettings } from "./settings.server.ts";

test("updates the managed provider timeout and preserves its label", async () => {
  const pluginRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(pluginRoot, "..", "..");
  let provider: ProviderEntry | undefined = { ...providerEntryFor(repoRoot), label: "My Claude" };
  const patches: unknown[] = [];
  let refreshes = 0;
  const paseo = {
    config: {
      get: async () => ({ config: { plugins: { "claude-tty": { path: pluginRoot } }, providers: { [PROVIDER_ID]: provider } } }),
      patch: async (patch: { removeProviders?: string[]; providers?: Record<string, ProviderEntry> }) => {
        patches.push(patch);
        if (patch.removeProviders?.includes(PROVIDER_ID)) provider = undefined;
        if (patch.providers?.[PROVIDER_ID]) provider = patch.providers[PROVIDER_ID];
      },
    },
    providers: { refresh: async () => void (refreshes += 1) },
  } as unknown as PaseoApi;

  const status = await updateSettings(paseo, 7_200_000);

  assert.equal(provider?.label, "My Claude");
  assert.equal(provider?.env[IDLE_TIMEOUT_ENV], "7200000");
  assert.equal(status.settings.idleTimeoutMs, 7_200_000);
  assert.equal(status.provider.state, "matching");
  assert.equal(refreshes, 1);
  assert.deepEqual(patches[0], { removeProviders: [PROVIDER_ID] });
});

test("refuses to overwrite an unrecognised provider", async () => {
  const pluginRoot = path.resolve(import.meta.dirname, "..", "..");
  const paseo = {
    config: {
      get: async () => ({
        config: {
          plugins: { "claude-tty": { path: pluginRoot } },
          providers: { [PROVIDER_ID]: { extends: "acp", command: ["/usr/bin/trae"] } },
        },
      }),
      patch: async () => assert.fail("foreign provider must not be patched"),
    },
    providers: { refresh: async () => assert.fail("foreign provider must not be refreshed") },
  } as unknown as PaseoApi;

  await assert.rejects(updateSettings(paseo, 900_000), /Install or repair/);
});

test("restores the provider if writing the replacement fails", async () => {
  const pluginRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(pluginRoot, "..", "..");
  const original = providerEntryFor(repoRoot);
  let provider: ProviderEntry | undefined = original;
  let writes = 0;
  const paseo = {
    config: {
      get: async () => ({ config: { plugins: { "claude-tty": { path: pluginRoot } }, providers: { [PROVIDER_ID]: provider } } }),
      patch: async (patch: { removeProviders?: string[]; providers?: Record<string, ProviderEntry> }) => {
        if (patch.removeProviders?.includes(PROVIDER_ID)) provider = undefined;
        const replacement = patch.providers?.[PROVIDER_ID];
        if (!replacement) return;
        writes += 1;
        if (writes === 1) throw new Error("write failed");
        provider = replacement;
      },
    },
    providers: { refresh: async () => assert.fail("a failed update must not be refreshed") },
  } as unknown as PaseoApi;

  await assert.rejects(updateSettings(paseo, 900_000), /write failed/);
  assert.deepEqual(provider, original);
  assert.equal(writes, 2);
});
