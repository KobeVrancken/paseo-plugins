import { readdir } from "node:fs/promises";
import path from "node:path";
import { writeLog } from "./log.ts";
import { TranscriptReader, type TranscriptRecord } from "./transcript-reader.ts";
import { agentIdFromFileName, subagentsDirectory } from "./subagent-transcript.ts";

/** A subagent's steps are worth following closely, but not as closely as the session's own turn. */
const POLL_INTERVAL_MS = 200;

export type SubagentSink = {
  translateSubagent(agentId: string, records: TranscriptRecord[]): Promise<void>;
};

/**
 * Follows the transcript Claude writes for every subagent it runs. The session's own transcript
 * says only that an agent was launched, so without this the whole of a subagent's work — minutes of
 * it, for an asynchronous one — happens with nothing to show for it.
 */
export class SubagentWatcher {
  private readonly directory: string;
  private readonly sink: SubagentSink;
  private readonly cwd: string;
  private readonly pollIntervalMs: number;
  private readonly readers = new Map<string, TranscriptReader>();
  private lastPoll = 0;
  private closed = false;

  constructor(transcriptFilePath: string, sink: SubagentSink, cwd: string, pollIntervalMs = POLL_INTERVAL_MS) {
    this.directory = subagentsDirectory(transcriptFilePath);
    this.sink = sink;
    this.cwd = cwd;
    this.pollIntervalMs = pollIntervalMs;
  }

  /** `force` is for the end of a turn, where the cost of one more read is worth the last word. */
  async sync(force = false): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    if (!force && now - this.lastPoll < this.pollIntervalMs) return;
    this.lastPoll = now;
    await this.discover();
    for (const [agentId, reader] of [...this.readers]) {
      const { records } = await reader.read().catch(() => ({ records: [] as TranscriptRecord[] }));
      if (records.length > 0) await this.sink.translateSubagent(agentId, records);
    }
  }

  /**
   * Reopened rather than replaced when a suspended session wakes, because the readers hold how far
   * into each subagent's transcript this has read, and a fresh one would stream every step again.
   */
  open(): void {
    this.closed = false;
  }

  close(): void {
    this.closed = true;
  }

  /** A session that has never run a subagent has no directory, which is not a failure to report. */
  private async discover(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (!isMissing(error)) {
        writeLog({ level: "warn", message: "Could not list subagent transcripts", directory: this.directory, error: String(error) });
      }
      return;
    }
    for (const name of names.sort()) {
      const agentId = agentIdFromFileName(name);
      if (agentId === null || this.readers.has(agentId)) continue;
      this.readers.set(agentId, new TranscriptReader(agentId, this.cwd, { filePath: path.join(this.directory, name) }));
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
