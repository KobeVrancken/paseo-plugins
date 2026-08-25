/**
 * Where the `@` or `/` the user is typing starts and ends, and what replaces it once they pick.
 * All of it is pure text arithmetic, so the composer's behaviour can be tested without a keyboard.
 */
export type Range = { start: number; end: number; query: string };

export type SlashRange = Range & { position: "start" | "inline" };

const INVALID_MENTION_CHARS = /[\s\n\r\t"']/;
const INVALID_COMMAND_CHARS = /[/\s\n\r\t"']/;

function clamp(cursorIndex: number, length: number): number {
  return Math.max(0, Math.min(cursorIndex, length));
}

/** The nearest `@` before the cursor whose tail is still one unbroken word. */
export function findActiveFileMention(input: { text: string; cursorIndex: number }): Range | null {
  const cursor = clamp(input.cursorIndex, input.text.length);
  const before = input.text.slice(0, cursor);
  for (
    let at = before.lastIndexOf("@");
    at >= 0;
    at = at === 0 ? -1 : before.lastIndexOf("@", at - 1)
  ) {
    const query = before.slice(at + 1);
    if (INVALID_MENTION_CHARS.test(query)) continue;
    return { start: at, end: cursor, query };
  }
  return null;
}

/**
 * A slash only opens the menu at the start of a word, so a path typed into the prompt does not.
 * A command at the very start of the prompt is the only kind the CLI runs, which is why the
 * position is reported.
 */
export function findActiveSlashCommand(input: { text: string; cursorIndex: number }): SlashRange | null {
  const cursor = clamp(input.cursorIndex, input.text.length);
  const before = input.text.slice(0, cursor);
  for (
    let at = before.lastIndexOf("/");
    at >= 0;
    at = at === 0 ? -1 : before.lastIndexOf("/", at - 1)
  ) {
    const previous = at > 0 ? input.text[at - 1]! : "";
    if (previous !== "" && !/\s/.test(previous)) continue;
    const query = before.slice(at + 1);
    if (INVALID_COMMAND_CHARS.test(query)) continue;
    return { start: at, end: cursor, query, position: at === 0 ? "start" : "inline" };
  }
  return null;
}

/**
 * Picking replaces the whole trigger, and a pick that ends the prompt leaves a space behind it, so
 * the menu closes and the next word starts clean. Paseo quotes the path where the CLI wants a bare
 * one; here it keeps its `@`, which is what makes it a mention to Claude Code rather than prose.
 */
export function applyFileMention(input: { text: string; mention: Range; path: string }): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}@${input.path}${after}${after === "" ? " " : ""}`;
}

export function applySlashCommand(input: { text: string; command: Range; name: string }): string {
  const before = input.text.slice(0, input.command.start);
  const after = input.text.slice(input.command.end);
  return `${before}/${input.name}${after}${after === "" ? " " : ""}`;
}

/** Keeps the active row in view without moving the list any further than it has to. */
export function scrollOffsetFor(input: {
  currentOffset: number;
  viewportHeight: number;
  itemTop: number;
  itemHeight: number;
}): number {
  if (input.viewportHeight <= 0) return input.currentOffset;
  const itemBottom = input.itemTop + input.itemHeight;
  if (input.itemTop < input.currentOffset) return Math.max(0, input.itemTop);
  if (itemBottom > input.currentOffset + input.viewportHeight) {
    return Math.max(0, itemBottom - input.viewportHeight);
  }
  return input.currentOffset;
}

const BOLT_GLYPHS = /\u26A1|\uFE0F/gu;

/** Some commands decorate their name with a bolt; the menu shows the name. */
export function withoutBoltGlyphs(value: string | undefined): string | undefined {
  if (value === undefined) return value;
  const cleaned = value.replace(BOLT_GLYPHS, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** The list sits above the input, so it reads bottom-up and starts on its last row. */
export function orderOptions<Option>(options: readonly Option[]): Option[] {
  return [...options].reverse();
}

export function fallbackIndex(count: number): number {
  return count <= 0 ? -1 : count - 1;
}

export function nextIndex(input: {
  currentIndex: number;
  count: number;
  key: "ArrowDown" | "ArrowUp";
}): number {
  if (input.count <= 0) return -1;
  if (input.currentIndex < 0) return input.key === "ArrowDown" ? 0 : input.count - 1;
  const current = input.currentIndex % input.count;
  return input.key === "ArrowDown"
    ? (current + 1) % input.count
    : (current - 1 + input.count) % input.count;
}
