import type { DiffLine } from "./render-types.shared.ts";

const MAX_LCS_CELLS = 400_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

function replaceWholeBlock(before: string[], after: string[]): DiffLine[] {
  return [
    ...before.map((text): DiffLine => ({ kind: "del", text })),
    ...after.map((text): DiffLine => ({ kind: "add", text })),
  ];
}

/** Line diff over the two sides of an Edit, LCS-based so unchanged lines stay as context. */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = splitLines(before);
  const right = splitLines(after);
  if (left.length * right.length > MAX_LCS_CELLS) return replaceWholeBlock(left, right);

  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        left[i] === right[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ kind: "ctx", text: left[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "del", text: left[i]! });
      i += 1;
    } else {
      lines.push({ kind: "add", text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) {
    lines.push({ kind: "del", text: left[i]! });
    i += 1;
  }
  while (j < right.length) {
    lines.push({ kind: "add", text: right[j]! });
    j += 1;
  }
  return lines;
}

/** Long unchanged runs are collapsed to a few lines of context around each change. */
export function trimDiffContext(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.kind === "ctx") continue;
    for (let offset = -context; offset <= context; offset += 1) {
      const neighbour = index + offset;
      if (neighbour >= 0 && neighbour < lines.length) keep[neighbour] = true;
    }
  }
  const trimmed: DiffLine[] = [];
  let skipped = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (keep[index]) {
      if (skipped > 0) {
        trimmed.push({ kind: "ctx", text: `⋯ ${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
        skipped = 0;
      }
      trimmed.push(lines[index]!);
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    trimmed.push({ kind: "ctx", text: `⋯ ${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
  }
  return trimmed;
}
