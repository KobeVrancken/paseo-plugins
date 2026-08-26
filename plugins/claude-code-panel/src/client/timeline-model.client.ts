import type { RenderEntry, ToolKind } from "../render-types.shared.ts";

export type TimelineItem =
  | { kind: "entry"; key: string; entry: RenderEntry }
  | { kind: "sidechain"; key: string; entries: RenderEntry[] }
  | { kind: "pending"; key: string; entry: RenderEntry };

/** A prompt the panel has shown but the transcript has not caught up with yet. */
export type PendingPrompt = { id: string; text: string; afterIndex: number };

/**
 * A sent prompt is drawn straight away, because the CLI takes a second or two to write it down and a
 * chat window that swallows what you just typed reads as broken.
 */
export function pendingItems(pending: PendingPrompt[]): TimelineItem[] {
  return pending.map((prompt) => ({
    kind: "pending",
    key: `pending:${prompt.id}`,
    entry: {
      index: prompt.afterIndex,
      id: `pending:${prompt.id}`,
      ts: null,
      isSidechain: false,
      body: { kind: "user_text", text: prompt.text },
    },
  }));
}

/**
 * An echo lasts until the transcript has a user line of its own to take its place.
 * They are matched in order of arrival rather than by text, because the CLI does not always write
 * back what was typed at it — a queued prompt picks up the interrupt, and a slash command is
 * rewritten into whatever it expands to.
 */
export function reconcilePending(pending: PendingPrompt[], entries: RenderEntry[]): PendingPrompt[] {
  if (pending.length === 0) return pending;
  const arrived = entries
    .filter((entry) => !entry.isSidechain && entry.body.kind === "user_text")
    .map((entry) => entry.index);
  let next = 0;
  const remaining = pending.filter((prompt) => {
    while (next < arrived.length && arrived[next]! < prompt.afterIndex) next += 1;
    if (next >= arrived.length) return true;
    next += 1;
    return false;
  });
  return remaining.length === pending.length ? pending : remaining;
}

/** Consecutive subagent lines collapse into one card so a long sidechain cannot bury the main thread. */
export function groupEntries(entries: RenderEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let run: RenderEntry[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    items.push({ kind: "sidechain", key: `sidechain:${run[0]!.index}`, entries: run });
    run = [];
  };

  for (const entry of entries) {
    if (entry.isSidechain) {
      run.push(entry);
      continue;
    }
    flushRun();
    items.push({ kind: "entry", key: `${entry.index}:${entry.id}`, entry });
  }
  flushRun();
  return items;
}

const TOOL_GLYPHS: Record<ToolKind, string> = {
  bash: "❯",
  edit: "✎",
  write: "✚",
  read: "▤",
  search: "⌕",
  web: "◇",
  agent: "⚙",
  generic: "▸",
};

export function toolGlyph(kind: ToolKind): string {
  return TOOL_GLYPHS[kind] ?? "▸";
}

export function statusGlyph(status: "pending" | "ok" | "error"): string {
  return status === "pending" ? "…" : status === "error" ? "✗" : "✓";
}

export function todoGlyph(status: "pending" | "in_progress" | "completed"): string {
  return status === "completed" ? "☑" : status === "in_progress" ? "▸" : "☐";
}
