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

export const DEFAULT_SETTINGS: PresenceSettings = {
  enabled: true,
  applicationId: null,
  detailLevel: "detailed",
  mutedProjects: [],
};

export function isProjectMuted(settings: PresenceSettings, projectRootPath: string): boolean {
  return settings.mutedProjects.some((project) => project.rootPath === projectRootPath);
}

function isLive(status: WorkspaceStatus): boolean {
  return status === "running" || status === "needs_input" || status === "attention";
}

/** A workspace still working or still waiting on you is active now, whatever its last stamp says. */
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Being blocked on the user outranks work in flight, in both the second line and the small image. */
function activityClause(workspaces: readonly WorkspaceActivity[], agents: AgentTally): string {
  const waiting =
    agents.needsAttention +
    workspaces.filter((workspace) => workspace.status === "needs_input").length;
  if (waiting > 0) return `${waiting} waiting for input`;
  if (agents.running > 0) return `${plural(agents.running, "agent")} running`;
  return "idle";
}

function smallImage(active: WorkspaceActivity, agents: AgentTally): { key: string; text: string } {
  if (agents.needsAttention > 0 || active.status === "needs_input" || active.status === "attention") {
    return { key: "attention", text: "Waiting for input" };
  }
  if (agents.running > 0 || active.status === "running") return { key: "running", text: "Running" };
  return { key: "idle", text: "Idle" };
}

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

  const active = rankWorkspaces(snapshot.workspaces, now).find(
    (workspace) => !isProjectMuted(settings, workspace.projectRootPath),
  );
  if (!active) return anonymousActivity(startTimestamp);

  const image = smallImage(active, snapshot.agents);
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
    smallImageKey: image.key,
    smallImageText: image.text,
    startTimestamp,
  };
}
