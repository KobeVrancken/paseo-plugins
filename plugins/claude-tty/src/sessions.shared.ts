export const SESSION_SUFFIX = ".json";
export const LOCK_SUFFIX = ".lock";

/** A file read out of the state directory, or its name alone when reading it failed. */
export type StateFile = { name: string; contents: string | null };

export type SessionLock = { pid: number; createdAt: number; live: boolean };

export type SessionEntry = {
  id: string;
  claudeSessionId: string | null;
  cwd: string | null;
  model: string | null;
  mode: string | null;
  lastActivity: number | null;
  /** The session file exists but says nothing the adapter could resume from. */
  corrupt: boolean;
  /** A session file the adapter never wrote, seen only through the lock left behind. */
  orphanLock: boolean;
  lock: SessionLock | null;
};

/**
 * The state directory is two flat directories keyed by ACP session ID, so the join is on the file
 * stem. A lock with no session beside it is still worth listing: releasing it is the whole point.
 */
export function joinSessions(
  sessions: readonly StateFile[],
  locks: readonly StateFile[],
  isAlive: (pid: number) => boolean,
): SessionEntry[] {
  const lockById = new Map<string, SessionLock>();
  for (const file of locks) {
    if (!file.name.endsWith(LOCK_SUFFIX)) continue;
    const record = parseLock(file.contents);
    lockById.set(file.name.slice(0, -LOCK_SUFFIX.length), {
      pid: record?.pid ?? -1,
      createdAt: record?.createdAt ?? 0,
      live: record === null ? false : isAlive(record.pid),
    });
  }

  const entries: SessionEntry[] = [];
  for (const file of sessions) {
    if (!file.name.endsWith(SESSION_SUFFIX)) continue;
    const id = file.name.slice(0, -SESSION_SUFFIX.length);
    const session = parseSession(file.contents);
    const lock = lockById.get(id) ?? null;
    lockById.delete(id);
    entries.push({
      id,
      claudeSessionId: session?.claudeSessionId ?? null,
      cwd: session?.cwd ?? null,
      model: session?.model ?? null,
      mode: session?.mode ?? null,
      lastActivity: session?.lastActivity ?? null,
      corrupt: session === null,
      orphanLock: false,
      lock,
    });
  }

  for (const [id, lock] of lockById) {
    entries.push({
      id,
      claudeSessionId: null,
      cwd: null,
      model: null,
      mode: null,
      lastActivity: null,
      corrupt: false,
      orphanLock: true,
      lock,
    });
  }

  return entries.sort(byRecency);
}

/** Live sessions first, then the most recently used, then something stable. */
function byRecency(a: SessionEntry, b: SessionEntry): number {
  if ((a.lock?.live ?? false) !== (b.lock?.live ?? false)) return a.lock?.live ? -1 : 1;
  if (a.lastActivity !== b.lastActivity) return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  return a.id.localeCompare(b.id);
}


type ParsedSession = { claudeSessionId: string; cwd: string; model: string; mode: string; lastActivity: number };

function parseSession(contents: string | null): ParsedSession | null {
  const record = parseObject(contents);
  if (record === null) return null;
  if (
    typeof record.claudeSessionId !== "string" ||
    typeof record.cwd !== "string" ||
    typeof record.model !== "string" ||
    typeof record.mode !== "string" ||
    typeof record.lastActivity !== "number"
  ) {
    return null;
  }
  return {
    claudeSessionId: record.claudeSessionId,
    cwd: record.cwd,
    model: record.model,
    mode: record.mode,
    lastActivity: record.lastActivity,
  };
}

function parseLock(contents: string | null): { pid: number; createdAt: number } | null {
  const record = parseObject(contents);
  if (record === null || typeof record.pid !== "number" || typeof record.createdAt !== "number") return null;
  return { pid: record.pid, createdAt: record.createdAt };
}

function parseObject(contents: string | null): Record<string, unknown> | null {
  if (contents === null) return null;
  try {
    const parsed: unknown = JSON.parse(contents);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Guards a name coming back from the client before it is joined onto the state directory. */
export function isSafeStateFileStem(stem: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stem) && !stem.includes("..");
}
