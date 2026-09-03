/**
 * What the panel can know about the subagents a session is running. Claude records a subagent's
 * work in a transcript of its own, and says only in the session's transcript that it was launched
 * and — for one launched asynchronously — that it has stopped, so both files are read.
 */

const AGENT_FILE_PREFIX = "agent-";
const AGENT_FILE_SUFFIX = ".jsonl";
const AGENT_META_SUFFIX = ".meta.json";
const STEP_CHARS = 200;

export type SubagentStatus = "running" | "completed" | "failed" | "unknown";

/** A subagent as the session's own transcript describes it. */
export type SubagentLaunch = { agentId: string; description: string | null; running: boolean };

/** The end of an asynchronous subagent, which is reported nowhere else. */
export type SubagentOutcome = { agentId: string; status: SubagentStatus; summary: string | null };

/** A subagent's transcript on disk, which is the only record of one whose launch is long compacted away. */
export type SubagentFile = {
  agentId: string;
  lastActivity: number;
  /** What the sidecar Claude writes beside the transcript says, where there is one. */
  meta: SubagentMeta | null;
  /** The opening line of its prompt, read only when nothing better names it. */
  prompt: string | null;
};

/** The sidecar Claude writes when it spawns a subagent, which names it without reading anything else. */
export type SubagentMeta = { description: string | null; nested: boolean };

export type Subagent = {
  agentId: string;
  description: string | null;
  status: SubagentStatus;
  summary: string | null;
  /** Launched by another subagent rather than by the session, which is why it has no card of its own. */
  nested: boolean;
  lastActivity: number | null;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long ago a subagent last wrote anything, which is the only sign of life its file gives. */
export function lastStepLabel(lastActivity: number | null, now: number): string | null {
  if (lastActivity === null || !Number.isFinite(lastActivity)) return null;
  const elapsed = now - lastActivity;
  if (elapsed < MINUTE_MS) return "last step just now";
  if (elapsed < HOUR_MS) return `last step ${count(elapsed / MINUTE_MS, "minute")} ago`;
  return `last step ${count(elapsed / HOUR_MS, "hour")} ago`;
}

function count(units: number, unit: string): string {
  const whole = Math.floor(units);
  return `${whole} ${unit}${whole === 1 ? "" : "s"}`;
}

export function agentIdFromFileName(name: string): string | null {
  if (!name.startsWith(AGENT_FILE_PREFIX) || !name.endsWith(AGENT_FILE_SUFFIX)) return null;
  const agentId = name.slice(AGENT_FILE_PREFIX.length, -AGENT_FILE_SUFFIX.length);
  return agentId === "" ? null : agentId;
}

export function subagentFileName(agentId: string): string {
  return `${AGENT_FILE_PREFIX}${agentId}${AGENT_FILE_SUFFIX}`;
}

export function subagentMetaFileName(agentId: string): string {
  return `${AGENT_FILE_PREFIX}${agentId}${AGENT_META_SUFFIX}`;
}

/** Older versions of Claude wrote no sidecar, so an unreadable one is a name to find elsewhere. */
export function parseMeta(contents: string | null): SubagentMeta | null {
  if (contents === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) return null;
  return {
    description: typeof record.description === "string" && record.description !== "" ? record.description : null,
    nested: typeof record.spawnDepth === "number" && record.spawnDepth > 1,
  };
}

export function parseRecords(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // A half-written final line is the normal state of a transcript being appended to.
    }
  }
  return records;
}

/** Claude names the launched agent in the metadata it keeps beside the tool result. */
export function readLaunches(records: readonly Record<string, unknown>[]): SubagentLaunch[] {
  const launches: SubagentLaunch[] = [];
  for (const record of records) {
    const result = asRecord(record.toolUseResult);
    const agentId = result?.agentId;
    if (typeof agentId !== "string" || agentId === "") continue;
    launches.push({
      agentId,
      description: typeof result?.description === "string" ? result.description : null,
      running: result?.status === "async_launched",
    });
  }
  return launches;
}

export function readOutcomes(records: readonly Record<string, unknown>[]): SubagentOutcome[] {
  const outcomes: SubagentOutcome[] = [];
  for (const record of records) {
    for (const text of messageTexts(record)) {
      for (const match of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const body = match[1] ?? "";
        const agentId = tag(body, "task-id");
        if (agentId === null) continue;
        const status = tag(body, "status");
        outcomes.push({ agentId, status: status === "completed" ? "completed" : "failed", summary: tag(body, "summary") });
      }
    }
  }
  return outcomes;
}

/**
 * A subagent is listed because its transcript exists, so one whose launch was compacted out of the
 * session's transcript — or one launched by another subagent, which the session never records — is
 * still shown, named after its sidecar or its own opening prompt rather than dropped.
 */
export function joinSubagents(
  files: readonly SubagentFile[],
  launches: ReadonlyMap<string, SubagentLaunch>,
  outcomes: ReadonlyMap<string, SubagentOutcome>,
): Subagent[] {
  return files
    .map((file) => {
      const launch = launches.get(file.agentId) ?? null;
      const outcome = outcomes.get(file.agentId) ?? null;
      return {
        agentId: file.agentId,
        description: file.meta?.description ?? launch?.description ?? file.prompt,
        status: subagentStatus(launch, outcome),
        summary: outcome?.summary ?? null,
        nested: file.meta?.nested ?? false,
        lastActivity: file.lastActivity,
      };
    })
    .sort(byRunningThenRecency);
}

function subagentStatus(launch: SubagentLaunch | null, outcome: SubagentOutcome | null): SubagentStatus {
  if (outcome !== null) return outcome.status;
  if (launch === null) return "unknown";
  // A subagent that was not launched asynchronously has already answered its launcher by now.
  return launch.running ? "running" : "completed";
}

function byRunningThenRecency(a: Subagent, b: Subagent): number {
  if ((a.status === "running") !== (b.status === "running")) return a.status === "running" ? -1 : 1;
  if (a.lastActivity !== b.lastActivity) return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  return a.agentId.localeCompare(b.agentId);
}

/**
 * The steps a subagent took, in the shape the session's own tool call shows them, so the panel and
 * the conversation do not describe the same work in two different ways.
 */
export function subagentSteps(records: readonly Record<string, unknown>[]): string[] {
  const steps: string[] = [];
  for (const record of records) {
    const content = asRecord(record.message)?.content;
    if (record.type !== "assistant" || !Array.isArray(content)) continue;
    for (const value of content) {
      const block = asRecord(value);
      if (block?.type === "text" && typeof block.text === "string") steps.push(oneLine(block.text));
      if (block?.type === "tool_use") steps.push(`• ${toolTitle(block)}`);
    }
  }
  return steps.filter((step) => step !== "");
}

/** The prompt a subagent was given, which names it when nothing else does. */
export function promptOf(records: readonly Record<string, unknown>[]): string | null {
  for (const record of records) {
    if (record.type !== "user") continue;
    for (const text of messageTexts(record)) {
      const line = oneLine(text);
      if (line !== "") return line;
    }
  }
  return null;
}

function toolTitle(block: Record<string, unknown>): string {
  const name = typeof block.name === "string" ? block.name : "Tool";
  const input = asRecord(block.input) ?? {};
  const detail = [input.description, input.file_path, input.query, input.pattern, input.command].find(
    (value): value is string => typeof value === "string" && value !== "",
  );
  return detail === undefined ? name : oneLine(`${name}: ${detail}`);
}

function messageTexts(record: Record<string, unknown>): string[] {
  const content = asRecord(record.message)?.content;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((value) => {
    const block = asRecord(value);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  });
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > STEP_CHARS ? `${collapsed.slice(0, STEP_CHARS - 1)}…` : collapsed;
}

function tag(body: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
