import type { PaseoApi } from "@getpaseo/client";
import type { StatusPayload } from "../contracts.shared.ts";
import { PROVIDER_ID, classifyProviderEntry, idleTimeoutOf, providerEntryFor, type ProviderEntry } from "../provider.shared.ts";
import { DEFAULT_IDLE_TIMEOUT_MS, MAX_IDLE_TIMEOUT_MS } from "../settings.shared.ts";
import { messageOf, resolveRepoRoot } from "./paths.server.ts";
import { readProviderEntry, readStatus } from "./status.server.ts";

export async function updateSettings(paseo: PaseoApi, idleTimeoutMs: number): Promise<StatusPayload> {
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 0 || idleTimeoutMs > MAX_IDLE_TIMEOUT_MS) {
    throw new Error(`Idle timeout must be an integer from 0 through ${MAX_IDLE_TIMEOUT_MS} milliseconds.`);
  }
  const repo = await resolveRepoRoot(paseo);
  if (repo.root === null) throw new Error(repo.problem);
  const existing = await readProviderEntry(paseo);
  const current = idleTimeoutOf(existing) ?? DEFAULT_IDLE_TIMEOUT_MS;
  if (classifyProviderEntry(existing, providerEntryFor(repo.root, current)) !== "matching") {
    throw new Error("Install or repair the Claude TTY provider before changing its settings.");
  }
  const next = providerEntryFor(repo.root, idleTimeoutMs);
  const label = labelOf(existing);
  if (label !== null) next.label = label;
  let removed = false;
  try {
    // The daemon deep-merges provider entries, so remove first to avoid retaining stale environment keys.
    await paseo.config.patch({ removeProviders: [PROVIDER_ID] });
    removed = true;
    await paseo.config.patch({ providers: { [PROVIDER_ID]: next } });
  } catch (error) {
    if (removed) {
      try {
        await paseo.config.patch({ providers: { [PROVIDER_ID]: existing as ProviderEntry } });
      } catch (restoreError) {
        throw new Error(
          `Could not update the Claude TTY provider (${messageOf(error)}) or restore its previous entry (${messageOf(restoreError)}).`,
        );
      }
    }
    throw new Error(`Could not update the Claude TTY provider: ${messageOf(error)}`);
  }
  try {
    await paseo.providers.refresh();
  } catch (error) {
    throw new Error(`The setting was saved, but Paseo could not re-probe the Claude TTY provider: ${messageOf(error)}`);
  }
  return readStatus(paseo);
}

function labelOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const label = (entry as { label?: unknown }).label;
  return typeof label === "string" ? label : null;
}
