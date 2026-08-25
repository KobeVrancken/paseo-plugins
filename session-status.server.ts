import type { SessionStatus } from "./render-types.shared.ts";

/**
 * Minimal shape of the `PaseoApi` handed to plugin handlers.
 * Only workspace status and daemon config are used, and typing them here keeps the surface honest.
 */
export type PaseoLike = {
  workspaces: {
    ref(workspaceId: string): { refresh(): Promise<{ status?: string | null } | null> };
  };
  config: {
    get(): Promise<{ config: Record<string, unknown> }>;
    patch(patch: Record<string, unknown>): Promise<{ config: Record<string, unknown> }>;
  };
};

const STATUS_TTL_MS = 400;

type CacheEntry = { value: SessionStatus; expiresAt: number };

const cache = new Map<string, CacheEntry>();

/**
 * Terminal agent-hook activity is not exposed per terminal by the CLI or the plugin API; it only
 * surfaces aggregated into the workspace status bucket, which is what this reads.
 * The aggregation means a second busy terminal in the same workspace can report `running` here.
 */
export async function workspaceSessionStatus(
  paseo: PaseoLike,
  workspaceId: string,
): Promise<SessionStatus> {
  const cached = cache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let status: SessionStatus = "idle";
  try {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    const bucket = workspace?.status ?? null;
    status = bucket === "running" ? "running" : bucket === "needs_input" ? "needs_input" : "idle";
  } catch {
    status = "idle";
  }
  cache.set(workspaceId, { value: status, expiresAt: Date.now() + STATUS_TTL_MS });
  return status;
}

export async function hooksEnabled(paseo: PaseoLike): Promise<boolean> {
  const { config } = await paseo.config.get();
  return config.enableTerminalAgentHooks === true;
}

export async function enableHooks(paseo: PaseoLike): Promise<boolean> {
  const { config } = await paseo.config.patch({ enableTerminalAgentHooks: true });
  return config.enableTerminalAgentHooks === true;
}
