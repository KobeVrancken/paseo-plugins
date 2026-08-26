import type { AgentTally, PresenceSnapshot, WorkspaceActivity, WorkspaceStatus } from "./presence.shared.ts";

const WORKSPACE_STATUSES: readonly WorkspaceStatus[] = [
  "needs_input",
  "failed",
  "running",
  "attention",
  "done",
];

function parseTimestamp(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function coerceStatus(raw: unknown): WorkspaceStatus {
  return WORKSPACE_STATUSES.includes(raw as WorkspaceStatus) ? (raw as WorkspaceStatus) : "done";
}

/**
 * The daemon's payload types reach us as `any`, the protocol package not being installed
 * alongside the client SDK, so every field is checked here rather than trusted.
 */
export function toWorkspaceActivity(entry: unknown): WorkspaceActivity | null {
  const workspace = entry as Record<string, unknown> | null;
  if (!workspace || typeof workspace.projectRootPath !== "string") return null;
  return {
    projectRootPath: workspace.projectRootPath,
    projectDisplayName:
      typeof workspace.projectDisplayName === "string" && workspace.projectDisplayName.length > 0
        ? workspace.projectDisplayName
        : workspace.projectRootPath,
    workspaceName: typeof workspace.name === "string" ? workspace.name : "",
    status: coerceStatus(workspace.status),
    activityAt: parseTimestamp(workspace.activityAt),
    statusEnteredAt: parseTimestamp(workspace.statusEnteredAt),
  };
}

/** Counts what the second line reports. Closed and archived sessions are not activity. */
export function toAgentTally(entries: readonly unknown[]): AgentTally {
  let running = 0;
  let needsAttention = 0;
  for (const entry of entries) {
    const agent = (entry as { agent?: Record<string, unknown> } | null)?.agent;
    if (!agent) continue;
    if (agent.archivedAt) continue;
    if (agent.status === "closed") continue;
    if (agent.status === "running") running += 1;
    if (agent.requiresAttention === true) needsAttention += 1;
  }
  return { running, needsAttention };
}

export function toPresenceSnapshot(
  workspaceEntries: readonly unknown[],
  agentEntries: readonly unknown[],
): PresenceSnapshot {
  const workspaces: WorkspaceActivity[] = [];
  for (const entry of workspaceEntries) {
    const workspace = toWorkspaceActivity(entry);
    if (workspace) workspaces.push(workspace);
  }
  return { workspaces, agents: toAgentTally(agentEntries) };
}
