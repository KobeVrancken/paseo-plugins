import {
  DEFAULT_SETTINGS,
  DETAIL_LEVELS,
  type DetailLevel,
  type MutedProject,
  type PresenceSettings,
} from "./presence.shared.ts";

export type StoredState = {
  version: 1;
  settings: PresenceSettings;
};

function coerceDetailLevel(raw: unknown): DetailLevel {
  return DETAIL_LEVELS.includes(raw as DetailLevel) ? (raw as DetailLevel) : DEFAULT_SETTINGS.detailLevel;
}

/** Discord application ids are snowflakes, and a pasted one arrives with whatever whitespace came along. */
export function coerceApplicationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

function coerceMutedProjects(raw: unknown): MutedProject[] {
  if (!Array.isArray(raw)) return [];
  const projects: MutedProject[] = [];
  for (const entry of raw) {
    const project = entry as Partial<MutedProject> | null;
    if (!project || typeof project.rootPath !== "string" || project.rootPath.length === 0) continue;
    if (projects.some((existing) => existing.rootPath === project.rootPath)) continue;
    projects.push({
      rootPath: project.rootPath,
      displayName: typeof project.displayName === "string" ? project.displayName : project.rootPath,
    });
  }
  return projects;
}

export function coerceSettings(raw: unknown): PresenceSettings {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const settings = (
    typeof record.settings === "object" && record.settings !== null ? record.settings : record
  ) as Record<string, unknown>;
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : DEFAULT_SETTINGS.enabled,
    applicationId: coerceApplicationId(settings.applicationId),
    detailLevel: coerceDetailLevel(settings.detailLevel),
    mutedProjects: coerceMutedProjects(settings.mutedProjects),
  };
}

export function withMutedProject(
  settings: PresenceSettings,
  project: MutedProject,
  muted: boolean,
): PresenceSettings {
  const without = settings.mutedProjects.filter((entry) => entry.rootPath !== project.rootPath);
  return { ...settings, mutedProjects: muted ? [...without, project] : without };
}
