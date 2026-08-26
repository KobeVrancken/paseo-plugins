import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Env = Record<string, string | undefined>;

export function claudeHomeDir(env: Env = process.env): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) return configured;
  return path.join(env.HOME ?? os.homedir(), ".claude");
}

export function claudeProjectsDir(env: Env = process.env): string {
  return path.join(claudeHomeDir(env), "projects");
}

/** Claude Code names a project directory after its cwd with every non-alphanumeric character replaced by a dash. */
export function escapeProjectDirName(workspaceDir: string): string {
  return workspaceDir.replace(/[^a-zA-Z0-9]/g, "-");
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function firstLineCwd(filePath: string): Promise<string | null> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
    if (!line) return null;
    const parsed: unknown = JSON.parse(line);
    const cwd = (parsed as { cwd?: unknown } | null)?.cwd;
    return typeof cwd === "string" ? cwd : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * The escaping rule is not a documented contract, so a miss falls back to matching the `cwd`
 * recorded inside the transcripts themselves.
 */
export async function resolveProjectDir(
  workspaceDir: string,
  env: Env = process.env,
): Promise<string | null> {
  const projectsDir = claudeProjectsDir(env);
  const exact = path.join(projectsDir, escapeProjectDirName(workspaceDir));
  if (await isDirectory(exact)) return exact;

  let candidates: string[];
  try {
    candidates = await fs.readdir(projectsDir);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    const candidateDir = path.join(projectsDir, candidate);
    let files: string[];
    try {
      files = (await fs.readdir(candidateDir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files.slice(0, 3)) {
      if ((await firstLineCwd(path.join(candidateDir, file))) === workspaceDir) return candidateDir;
    }
  }
  return null;
}

export function cacheDir(env: Env = process.env): string {
  const base = env.XDG_CACHE_HOME?.trim() || path.join(env.HOME ?? os.homedir(), ".cache");
  return path.join(base, "paseo-plugins", "claude-code-panel");
}

export function imagesDir(env: Env = process.env): string {
  return path.join(cacheDir(env), "images");
}

export function filesDir(env: Env = process.env): string {
  return path.join(cacheDir(env), "files");
}

export function stateFilePath(env: Env = process.env): string {
  return path.join(cacheDir(env), "state.json");
}
