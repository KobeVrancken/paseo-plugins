export type DetailLevel = "detailed" | "projects" | "anonymous";

export type WorkspaceStatus = "needs_input" | "failed" | "running" | "attention" | "done";

export type WorkspaceActivity = {
  projectRootPath: string;
  projectDisplayName: string;
  workspaceName: string;
  status: WorkspaceStatus;
  /** Epoch ms of the daemon's own activity stamp, which older daemons never fill in. */
  activityAt: number | null;
  statusEnteredAt: number | null;
};

export type AgentTally = {
  running: number;
  needsAttention: number;
};

export type MutedProject = {
  rootPath: string;
  displayName: string;
};

export type PresenceSettings = {
  enabled: boolean;
  applicationId: string | null;
  detailLevel: DetailLevel;
  mutedProjects: MutedProject[];
};

export type PresenceSnapshot = {
  workspaces: WorkspaceActivity[];
  agents: AgentTally;
};

export type PresenceActivity = {
  details: string;
  state?: string;
  largeImageKey: string;
  largeImageText: string;
  smallImageKey?: string;
  smallImageText?: string;
  startTimestamp: number;
};

export const LARGE_IMAGE_KEY = "paseo";
export const LARGE_IMAGE_TEXT = "Paseo";
export const ANONYMOUS_DETAILS = "Using Paseo";

export const DETAIL_LEVELS: readonly DetailLevel[] = ["detailed", "projects", "anonymous"];

export const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  detailed: "Detailed",
  projects: "Projects only",
  anonymous: "Anonymous",
};

/** The application the plugin ships against, so an install shows a presence without a trip to the developer portal. */
export const MANAGED_APPLICATION_ID = "1542167510986653787";

export const DEFAULT_SETTINGS: PresenceSettings = {
  enabled: true,
  applicationId: MANAGED_APPLICATION_ID,
  detailLevel: "detailed",
  mutedProjects: [],
};

export function isProjectMuted(settings: PresenceSettings, projectRootPath: string): boolean {
  return settings.mutedProjects.some((project) => project.rootPath === projectRootPath);
}

function isLive(status: WorkspaceStatus): boolean {
  return status !== "done";
}

/** A workspace that has not finished is active now, whatever its last stamp says. */
function activeAt(workspace: WorkspaceActivity, now: number): number {
  if (isLive(workspace.status)) return now;
  return Math.max(workspace.activityAt ?? 0, workspace.statusEnteredAt ?? 0);
}

export function rankWorkspaces(
  workspaces: readonly WorkspaceActivity[],
  now: number,
): WorkspaceActivity[] {
  return [...workspaces].sort((left, right) => activeAt(right, now) - activeAt(left, now));
}

/** Past this, the last workspace is what you were doing rather than what you are doing. */
export const STALE_AFTER_MS = 30 * 60_000;

/**
 * The workspace the presence speaks for, or null when it should fall back to the anonymous
 * rendering. A muted workspace is only ever replaced by live work: promoting whatever merely ranks
 * behind it puts a project you are not in front of on your profile, which is what muting was for.
 */
function pickActive(
  workspaces: readonly WorkspaceActivity[],
  settings: PresenceSettings,
  now: number,
): WorkspaceActivity | null {
  const ranked = rankWorkspaces(workspaces, now);
  const first = ranked[0];
  if (!first) return null;
  if (!isProjectMuted(settings, first.projectRootPath)) {
    return activeAt(first, now) >= now - STALE_AFTER_MS ? first : null;
  }
  return (
    ranked.find(
      (workspace) =>
        isLive(workspace.status) && !isProjectMuted(settings, workspace.projectRootPath),
    ) ?? null
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function countStatus(workspaces: readonly WorkspaceActivity[], status: WorkspaceStatus): number {
  return workspaces.filter((workspace) => workspace.status === status).length;
}

/**
 * Paseo's own order of demand: a permission prompt outranks a failure, which outranks work still in
 * flight, which outranks a turn that has merely ended.
 */
function activityClause(workspaces: readonly WorkspaceActivity[], agents: AgentTally): string {
  const blocked = countStatus(workspaces, "needs_input");
  if (blocked > 0) return `${blocked} waiting for permission`;
  const failed = countStatus(workspaces, "failed");
  if (failed > 0) return `${failed} failed`;
  if (agents.running > 0) return `${plural(agents.running, "agent")} running`;
  if (agents.needsAttention > 0) return `${agents.needsAttention} waiting for you`;
  return "idle";
}

/**
 * The badge speaks for the workspace on the first line and nothing else. Reading it off a tally
 * across every project would turn it green for work in a project you muted precisely to hide.
 */
const BADGES: Record<WorkspaceStatus, { key: string; text: string }> = {
  needs_input: { key: "needs_input", text: "Waiting for permission" },
  failed: { key: "failed", text: "Failed" },
  running: { key: "running", text: "Running" },
  attention: { key: "attention", text: "Finished — your turn" },
  done: { key: "idle", text: "Idle" },
};

function describeWorkspace(active: WorkspaceActivity): string {
  const { projectDisplayName, workspaceName } = active;
  if (!workspaceName || workspaceName === projectDisplayName) return projectDisplayName;
  return `${projectDisplayName} — ${workspaceName}`;
}

function anonymousActivity(startTimestamp: number): PresenceActivity {
  return {
    details: ANONYMOUS_DETAILS,
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: LARGE_IMAGE_TEXT,
    startTimestamp,
  };
}

/**
 * Returns what Discord should show, or null when the plugin has nothing to say and the socket
 * should be closed rather than left holding a stale activity.
 */
export function renderActivity(
  snapshot: PresenceSnapshot,
  settings: PresenceSettings,
  startTimestamp: number,
  now: number,
): PresenceActivity | null {
  if (!settings.enabled || !settings.applicationId) return null;
  if (settings.detailLevel === "anonymous") return anonymousActivity(startTimestamp);

  const active = pickActive(snapshot.workspaces, settings, now);
  if (!active) return anonymousActivity(startTimestamp);

  const badge = BADGES[active.status];
  const count = plural(snapshot.workspaces.length, "workspace");
  return {
    details:
      settings.detailLevel === "projects" ? active.projectDisplayName : describeWorkspace(active),
    state:
      settings.detailLevel === "projects"
        ? count
        : `${count} · ${activityClause(snapshot.workspaces, snapshot.agents)}`,
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: LARGE_IMAGE_TEXT,
    smallImageKey: badge.key,
    smallImageText: badge.text,
    startTimestamp,
  };
}
