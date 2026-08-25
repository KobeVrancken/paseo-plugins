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
 * A file closes the menu behind a trailing space; a directory keeps it open on its own contents,
 * which is how you walk down a tree without typing the separators.
 */
export function applyFileMention(input: {
  text: string;
  mention: Range;
  path: string;
  kind: "file" | "directory";
}): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  const inserted = input.kind === "directory" ? `@${input.path}/` : `@${input.path} `;
  return `${before}${inserted}${after}`;
}

export function applySlashCommand(input: { text: string; command: Range; name: string }): string {
  const before = input.text.slice(0, input.command.start);
  const after = input.text.slice(input.command.end);
  return `${before}/${input.name}${after}${after === "" ? " " : ""}`;
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
