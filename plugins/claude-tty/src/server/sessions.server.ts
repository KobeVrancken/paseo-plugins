import { readdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { SessionsPayload } from "../contracts.shared.ts";
import { defaultStateDirectory, locksDirectory, sessionsDirectory } from "../paths.shared.ts";
import {
  LOCK_SUFFIX,
  SESSION_SUFFIX,
  isSafeStateFileStem,
  joinSessions,
  type SessionEntry,
  type StateFile,
} from "../sessions.shared.ts";
import { messageOf } from "./paths.server.ts";

export async function listSessions(): Promise<SessionsPayload> {
  const root = defaultStateDirectory();
  const sessions = await readDirectory(sessionsDirectory(root));
  const locks = await readDirectory(locksDirectory(root));
  const problem = sessions.problem ?? locks.problem;
  return {
    stateDirectory: root,
    problem,
    sessions: joinSessions(sessions.files, locks.files, processIsAlive),
  };
}

/** Only ever removes a lock the recorded process can no longer be holding. */
export async function releaseLock(id: string): Promise<SessionsPayload> {
  const entry = await requireEntry(id);
  if (entry.lock === null) throw new Error(`Session ${id} holds no lock.`);
  if (entry.lock.live) throw new Error(`Process ${entry.lock.pid} still holds session ${id}. Close that agent first.`);
  await unlink(path.join(locksDirectory(defaultStateDirectory()), `${id}${LOCK_SUFFIX}`));
  return listSessions();
}

/** Moves a session file aside rather than deleting it, so the failure can still be diagnosed. */
export async function quarantineSession(id: string): Promise<SessionsPayload> {
  const entry = await requireEntry(id);
  if (!entry.corrupt) throw new Error(`Session ${id} is readable, so there is nothing to quarantine.`);
  const directory = sessionsDirectory(defaultStateDirectory());
  const source = path.join(directory, `${id}${SESSION_SUFFIX}`);
  await rename(source, `${source}.corrupt-${Date.now()}`);
  return listSessions();
}

async function requireEntry(id: string): Promise<SessionEntry> {
  if (!isSafeStateFileStem(id)) throw new Error(`${id} is not a session in the state directory.`);
  const entry = (await listSessions()).sessions.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`Session ${id} is no longer in the state directory.`);
  return entry;
}

async function readDirectory(directory: string): Promise<{ files: StateFile[]; problem: string | null }> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    // A host that has never run a session has no state directory, which is not a problem to report.
    return { files: [], problem: isMissing(error) ? null : `${directory}: ${messageOf(error)}` };
  }
  const files = await Promise.all(
    names.map(async (name) => ({ name, contents: await readFile(path.join(directory, name), "utf8").catch(() => null) })),
  );
  return { files, problem: null };
}

/** Signal 0 the way the adapter checks it, so both agree on which locks are stale. */
function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
