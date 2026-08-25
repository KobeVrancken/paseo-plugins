import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeHomeDir, type Env } from "./paths.server.ts";

/**
 * The slice of Claude Code's own settings the composer shows.
 * `ultracode` is deliberately absent: the CLI describes it as lasting for one session only, so it is
 * never on disk to read.
 */
export type CliSettings = {
  effortLevel: string | null;
  thinking: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Claude Code layers settings user < project < project-local, with the later file winning. */
export function mergeCliSettings(files: unknown[]): CliSettings {
  const merged: CliSettings = { effortLevel: null, thinking: false };
  for (const file of files) {
    const record = asRecord(file);
    if (!record) continue;
    if (typeof record.effortLevel === "string") merged.effortLevel = record.effortLevel;
    if (typeof record.alwaysThinkingEnabled === "boolean") merged.thinking = record.alwaysThinkingEnabled;
  }
  return merged;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function readCliSettings(workspaceDir: string, env: Env = process.env): Promise<CliSettings> {
  const files = await Promise.all([
    readJson(path.join(claudeHomeDir(env), "settings.json")),
    readJson(path.join(workspaceDir, ".claude", "settings.json")),
    readJson(path.join(workspaceDir, ".claude", "settings.local.json")),
  ]);
  return mergeCliSettings(files);
}

/** Turns the model id on a transcript line into the short name the CLI itself shows. */
export function modelLabel(model: string | null): string | null {
  if (model === null || model.trim() === "") return null;
  const capitalize = (family: string) => `${family[0]!.toUpperCase()}${family.slice(1)}`;
  // A trailing date stamp is a release, not a version, so it never becomes part of the name.
  const current = /claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?$/.exec(model.trim());
  if (current) {
    const version = current[3] ? `${current[2]}.${current[3]}` : current[2];
    return `${capitalize(current[1]!)} ${version}`;
  }
  const legacy = /claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)(?:-\d{6,})?$/.exec(model.trim());
  if (legacy) {
    const version = legacy[2] ? `${legacy[1]}.${legacy[2]}` : legacy[1];
    return `${capitalize(legacy[3]!)} ${version}`;
  }
  return model;
}
