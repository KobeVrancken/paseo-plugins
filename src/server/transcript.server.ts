import { promises as fs } from "node:fs";
import path from "node:path";
import { capEntryForList, TimelineBuilder } from "./render-map.server.ts";
import { resolveProjectDir, type Env } from "./paths.server.ts";
import type { RenderEntry } from "../render-types.shared.ts";

const HEAD_SCAN_BYTES = 128 * 1024;
const SIGNATURE_BYTES = 256;
const TAIL_SCAN_BYTES = 64 * 1024;
const LIVE_WINDOW_MS = 60_000;
const INITIAL_WINDOW = 200;

export type SessionFileSummary = {
  sessionId: string;
  filePath: string;
  mtime: number;
  title: string | null;
  preview: string;
};

type SessionState = {
  sessionId: string;
  reportedUnknownKinds: Set<string>;
  filePath: string;
  builder: TimelineBuilder;
  offset: number;
  partialLine: string;
  revisionBase: number;
  /** First bytes of the file, re-read every poll to notice a rewrite that left the size unchanged or larger. */
  signature: string;
  signatureBytes: number;
};

export type TimelineSlice = {
  entries: RenderEntry[];
  windowStart: number;
  total: number;
  revision: number;
  reset: boolean;
  title: string | null;
  lastEntryTimestamp: string | null;
  mtime: number;
};

async function readRange(filePath: string, start: number, length: number): Promise<string> {
  if (length <= 0) return "";
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => {});
  }
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Summary shown in the session picker, derived without parsing the whole transcript. */
export async function readSessionSummary(filePath: string): Promise<SessionFileSummary | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  const sessionId = path.basename(filePath, ".jsonl");
  const head = await readRange(filePath, 0, Math.min(HEAD_SCAN_BYTES, stat.size));
  const tailStart = Math.max(0, stat.size - TAIL_SCAN_BYTES);
  const tail = tailStart > 0 ? await readRange(filePath, tailStart, stat.size - tailStart) : head;

  const headBuilder = new TimelineBuilder();
  for (const line of head.split("\n")) {
    const entry = parseLine(line);
    if (entry) headBuilder.push(entry);
    if (headBuilder.firstUserPrompt !== null && headBuilder.title !== null) break;
  }

  let title = headBuilder.title;
  for (const line of tail.split("\n")) {
    const entry = parseLine(line);
    if (!entry) continue;
    if (entry.type === "ai-title" || entry.type === "custom-title" || entry.type === "summary") {
      const tailBuilder = new TimelineBuilder();
      tailBuilder.push(entry);
      title = tailBuilder.title ?? title;
    }
  }

  const preview = (headBuilder.firstUserPrompt ?? "").replace(/\s+/g, " ").trim();
  return {
    sessionId,
    filePath,
    mtime: stat.mtimeMs,
    title,
    preview: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview,
  };
}

export function isRecentlyActive(mtime: number, now = Date.now()): boolean {
  return now - mtime < LIVE_WINDOW_MS;
}

/** Keeps one incrementally-parsed timeline per transcript file, reparsed only when the file shrinks. */
export class TranscriptStore {
  private states = new Map<string, SessionState>();
  private projectDirs = new Map<string, string>();
  private readonly env: Env;

  constructor(env: Env = process.env) {
    this.env = env;
  }

  async projectDir(workspaceDir: string): Promise<string | null> {
    const cached = this.projectDirs.get(workspaceDir);
    if (cached) return cached;
    const resolved = await resolveProjectDir(workspaceDir, this.env);
    if (resolved) this.projectDirs.set(workspaceDir, resolved);
    return resolved;
  }

  async listSessionFiles(workspaceDir: string): Promise<SessionFileSummary[]> {
    const projectDir = await this.projectDir(workspaceDir);
    if (!projectDir) return [];
    let names: string[];
    try {
      names = await fs.readdir(projectDir);
    } catch {
      return [];
    }
    const summaries = await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => readSessionSummary(path.join(projectDir, name))),
    );
    return summaries
      .filter((summary): summary is SessionFileSummary => summary !== null)
      .sort((left, right) => right.mtime - left.mtime);
  }

  async sessionFilePath(workspaceDir: string, sessionId: string): Promise<string | null> {
    const projectDir = await this.projectDir(workspaceDir);
    if (!projectDir) return null;
    return path.join(projectDir, `${sessionId}.jsonl`);
  }

  private async sync(workspaceDir: string, sessionId: string): Promise<{ state: SessionState; mtime: number } | null> {
    const filePath = await this.sessionFilePath(workspaceDir, sessionId);
    if (!filePath) return null;
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return null;
    }

    let state = this.states.get(filePath);
    if (!state) {
      state = {
        sessionId,
        filePath,
        builder: new TimelineBuilder(),
        offset: 0,
        partialLine: "",
        revisionBase: 0,
        signature: "",
        signatureBytes: 0,
        reportedUnknownKinds: new Set(),
      };
      this.states.set(filePath, state);
    }

    const signatureBytes =
      state.offset > 0 ? state.signatureBytes : Math.min(SIGNATURE_BYTES, stat.size);
    const signature = await readRange(filePath, 0, signatureBytes);
    if (stat.size < state.offset || (state.offset > 0 && signature !== state.signature)) {
      // The file was rewritten (compaction, resume into the same id): start over, keeping revisions monotonic.
      state.revisionBase += state.builder.revision + 1;
      state.builder = new TimelineBuilder();
      state.offset = 0;
      state.partialLine = "";
      state.signatureBytes = Math.min(SIGNATURE_BYTES, stat.size);
      state.signature = await readRange(filePath, 0, state.signatureBytes);
    } else if (state.offset === 0) {
      state.signature = signature;
      state.signatureBytes = signatureBytes;
    }

    if (stat.size > state.offset) {
      const chunk = await readRange(filePath, state.offset, stat.size - state.offset);
      state.offset = stat.size;
      const combined = state.partialLine + chunk;
      const lines = combined.split("\n");
      state.partialLine = lines.pop() ?? "";
      for (const line of lines) {
        const entry = parseLine(line);
        if (entry) state.builder.push(entry);
      }
      this.reportUnknownKinds(state);
    }
    return { state, mtime: stat.mtimeMs };
  }

  /** A line kind we cannot render is a gap against the CLI, so say so once in the plugin log. */
  private reportUnknownKinds(state: SessionState): void {
    for (const kind of state.builder.unknownKinds) {
      if (state.reportedUnknownKinds.has(kind)) continue;
      state.reportedUnknownKinds.add(kind);
      console.log(`session ${state.sessionId}: no renderer for transcript kind "${kind}"`);
    }
  }

  async timelineSince(
    workspaceDir: string,
    sessionId: string,
    sinceRevision: number,
    fromIndex: number | null = null,
  ): Promise<TimelineSlice | null> {
    const synced = await this.sync(workspaceDir, sessionId);
    if (!synced) return null;
    const { state, mtime } = synced;

    const revision = state.revisionBase + state.builder.revision;
    const reset = sinceRevision < state.revisionBase;
    const localSince = reset ? 0 : sinceRevision - state.revisionBase;
    const windowStart = fromIndex ?? Math.max(0, state.builder.total - INITIAL_WINDOW);
    return {
      entries: state.builder.changedSince(localSince, windowStart).map(capEntryForList),
      windowStart,
      total: state.builder.total,
      revision,
      reset: reset || sinceRevision === 0,
      title: state.builder.title,
      lastEntryTimestamp: state.builder.lastEntryTimestamp,
      mtime,
    };
  }

  /** The model the session last answered with, for the composer's model control. */
  async lastModel(workspaceDir: string, sessionId: string): Promise<string | null> {
    const synced = await this.sync(workspaceDir, sessionId);
    return synced?.state.builder.lastModel ?? null;
  }

  /** Full, uncapped body of a single entry, for a card the user expanded. */
  async entryAt(workspaceDir: string, sessionId: string, index: number): Promise<RenderEntry | null> {
    const synced = await this.sync(workspaceDir, sessionId);
    return synced?.state.builder.entryAt(index) ?? null;
  }

  forget(filePath: string): void {
    this.states.delete(filePath);
  }
}
