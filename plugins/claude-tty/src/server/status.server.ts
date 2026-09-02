import type { PaseoApi } from "@getpaseo/client";
import type { StatusPayload } from "../contracts.shared.ts";
import { adapterBinaryPath, adapterEntryPath, claudeCandidates, defaultStateDirectory } from "../paths.shared.ts";
import { PROVIDER_ID, classifyProviderEntry, commandOf, idleTimeoutOf, providerEntryFor } from "../provider.shared.ts";
import { DEFAULT_IDLE_TIMEOUT_MS } from "../settings.shared.ts";
import { fileExists, firstExecutable, resolveRepoRoot } from "./paths.server.ts";

export async function readStatus(paseo: PaseoApi): Promise<StatusPayload> {
  const [repo, claudeBinary] = await Promise.all([resolveRepoRoot(paseo), firstExecutable(claudeCandidates())]);
  const host = { node: process.version, claude: claudeBinary };
  const stateDirectory = defaultStateDirectory();

  if (repo.root === null) {
    return {
      repoRoot: null,
      problem: repo.problem,
      adapter: { binary: null, built: false },
      provider: { id: PROVIDER_ID, state: "absent", label: null, command: null, expectedCommand: null },
      host,
      stateDirectory,
      settings: { idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
    };
  }

  const [built, existing] = await Promise.all([fileExists(adapterEntryPath(repo.root)), readProviderEntry(paseo)]);
  const idleTimeoutMs = idleTimeoutOf(existing) ?? DEFAULT_IDLE_TIMEOUT_MS;
  const expected = providerEntryFor(repo.root, idleTimeoutMs);

  return {
    repoRoot: repo.root,
    problem: null,
    adapter: { binary: adapterBinaryPath(repo.root), built },
    provider: {
      id: PROVIDER_ID,
      state: classifyProviderEntry(existing, expected),
      label: labelOf(existing),
      command: commandOf(existing),
      expectedCommand: expected.command,
    },
    host,
    stateDirectory,
    settings: { idleTimeoutMs },
  };
}

export async function readProviderEntry(paseo: PaseoApi): Promise<unknown> {
  const { config } = await paseo.config.get();
  return config.providers?.[PROVIDER_ID];
}

function labelOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const label = (entry as { label?: unknown }).label;
  return typeof label === "string" ? label : null;
}
