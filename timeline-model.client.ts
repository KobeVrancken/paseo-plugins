import type { RenderEntry, ToolKind } from "./render-types.shared.ts";

export type TimelineItem =
  | { kind: "entry"; key: string; entry: RenderEntry }
  | { kind: "sidechain"; key: string; entries: RenderEntry[] };

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
