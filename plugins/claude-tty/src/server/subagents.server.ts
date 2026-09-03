import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SubagentsPayload, SubagentTranscriptPayload } from "../contracts.shared.ts";
import { subagentsDirectory, transcriptPath } from "../paths.shared.ts";
import { isSafeStateFileStem, type SessionEntry } from "../sessions.shared.ts";
import {
  agentIdFromFileName,
  joinSubagents,
  parseMeta,
  parseRecords,
  promptOf,
  readLaunches,
  readOutcomes,
  subagentFileName,
  subagentMetaFileName,
  subagentSteps,
  type SubagentFile,
  type SubagentLaunch,
  type SubagentMeta,
  type SubagentOutcome,
} from "../subagents.shared.ts";
import { messageOf } from "./paths.server.ts";
import { readState } from "./sessions.server.ts";

/** Enough of a subagent's transcript to name it, without reading a prompt that runs to pages. */
const PROMPT_BYTES = 8_192;
/** How many of a subagent's steps the panel is sent; the rest stay on disk and are counted. */
const STEP_LIMIT = 200;

/**
 * A session's transcript is appended to for as long as it lives, so it is read the way the adapter
 * reads it: once from the beginning, and from there on only what is new. Module scope is the only
 * state a plugin has between calls, which is exactly as long as this is worth keeping.
 */
type TranscriptScan = {
  offset: number;
  launches: Map<string, SubagentLaunch>;
  outcomes: Map<string, SubagentOutcome>;
};

const scans = new Map<string, TranscriptScan>();
/** Neither a subagent's sidecar nor its opening prompt changes, so both are read once. */
const names = new Map<string, { meta: SubagentMeta | null; prompt: string | null }>();

/**
 * Only sessions that are open are listed. A subagent lives inside its session's Claude process, so
 * one whose session has been stopped is not running anywhere, whatever its transcript last said.
 */
export async function listSubagents(): Promise<SubagentsPayload> {
  const reading = await readState();
  const sessions: SubagentsPayload["sessions"] = [];
  let problem: string | null = reading.problem;
  for (const session of reading.sessions) {
    if (session.lock?.live !== true || session.cwd === null || session.claudeSessionId === null) continue;
    try {
      sessions.push({
        sessionId: session.id,
        cwd: session.cwd,
        subagents: await sessionSubagents(session.cwd, session.claudeSessionId),
      });
    } catch (error) {
      problem = problem ?? `${session.id}: ${messageOf(error)}`;
    }
  }
  return { now: Date.now(), problem, sessions: sessions.filter((entry) => entry.subagents.length > 0) };
}

/** The steps one subagent took, read whole: it is asked for one agent at a time, on request. */
export async function readSubagentTranscript(sessionId: string, agentId: string): Promise<SubagentTranscriptPayload> {
  if (!isSafeStateFileStem(sessionId) || !isSafeStateFileStem(agentId)) {
    throw new Error(`${sessionId}/${agentId} is not a subagent of a session on this host.`);
  }
  const session = (await readState()).sessions.find((entry) => entry.id === sessionId);
  const file = subagentPath(session, agentId);
  if (file === null) throw new Error(`Session ${sessionId} is not open, so its subagents cannot be read.`);
  const handle = await open(file, "r");
  try {
    const steps = subagentSteps(parseRecords(await handle.readFile("utf8")));
    return { steps: steps.slice(-STEP_LIMIT), earlier: Math.max(0, steps.length - STEP_LIMIT) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function subagentPath(session: SessionEntry | undefined, agentId: string): string | null {
  if (session === undefined || session.cwd === null || session.claudeSessionId === null) return null;
  return path.join(subagentsDirectory(session.cwd, session.claudeSessionId), subagentFileName(agentId));
}

async function sessionSubagents(cwd: string, claudeSessionId: string) {
  const directory = subagentsDirectory(cwd, claudeSessionId);
  const files = await readSubagentFiles(directory);
  if (files.length === 0) return [];
  const scan = await scanTranscript(transcriptPath(cwd, claudeSessionId));
  return joinSubagents(files, scan.launches, scan.outcomes);
}

/** A session that has never run a subagent has no directory of them, which is not a problem. */
async function readSubagentFiles(directory: string): Promise<SubagentFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files: SubagentFile[] = [];
  for (const name of names) {
    const agentId = agentIdFromFileName(name);
    if (agentId === null) continue;
    const file = path.join(directory, name);
    const stats = await stat(file).catch(() => null);
    if (stats === null) continue;
    files.push({ agentId, lastActivity: stats.mtimeMs, ...(await nameOf(agentId, directory, file)) });
  }
  return files;
}

/** The sidecar names a subagent outright; the prompt is only read when there is no sidecar to read. */
async function nameOf(agentId: string, directory: string, file: string): Promise<{ meta: SubagentMeta | null; prompt: string | null }> {
  const cached = names.get(agentId);
  if (cached !== undefined) return cached;
  const meta = parseMeta(await readWhole(path.join(directory, subagentMetaFileName(agentId))));
  const prompt = meta?.description ? null : promptOf(parseRecords(await readHead(file, PROMPT_BYTES)));
  const name = { meta, prompt };
  names.set(agentId, name);
  return name;
}

async function readWhole(file: string): Promise<string | null> {
  const handle = await open(file, "r").catch(() => null);
  if (handle === null) return null;
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function scanTranscript(file: string): Promise<TranscriptScan> {
  const scan = scans.get(file) ?? { offset: 0, launches: new Map(), outcomes: new Map() };
  scans.set(file, scan);
  const size = (await stat(file).catch(() => null))?.size ?? null;
  if (size === null) return scan;
  // A compaction rewrites the transcript in place, and what it dropped is still worth having read.
  if (size < scan.offset) scan.offset = 0;
  if (size === scan.offset) return scan;
  const chunk = await readRange(file, scan.offset, size - scan.offset);
  const complete = chunk.lastIndexOf("\n");
  if (complete < 0) return scan;
  scan.offset += Buffer.byteLength(chunk.slice(0, complete + 1));
  const records = parseRecords(chunk.slice(0, complete));
  for (const launch of readLaunches(records)) scan.launches.set(launch.agentId, launch);
  for (const outcome of readOutcomes(records)) scan.outcomes.set(outcome.agentId, outcome);
  return scan;
}

async function readHead(file: string, length: number): Promise<string> {
  return readRange(file, 0, length);
}

async function readRange(file: string, start: number, length: number): Promise<string> {
  if (length <= 0) return "";
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
