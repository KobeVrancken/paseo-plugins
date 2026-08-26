/** Markers of an interactive Claude Code CLI screen; used to guess which terminal a session runs in. */
const CLAUDE_MARKERS = [
  /\?\s+for shortcuts/i,
  /esc to interrupt/i,
  /(auto|plan|accept edits|manual) mode on/i,
  /\d+(\.\d+)?[km]?\/\d+(\.\d+)?[km]? tokens/i,
];

export function looksLikeClaudeSession(lines: string[]): boolean {
  const screen = lines.join("\n");
  return CLAUDE_MARKERS.some((marker) => marker.test(screen));
}

export type DialogOption = {
  /** The digit the CLI prints, which is also the key that selects the option. */
  index: number;
  label: string;
  /** The second column of a menu row, which the CLI aligns behind a run of spaces. */
  description: string | null;
  checked: boolean;
  /** "Type something", "Chat about this", "Submit": CLI affordances rather than answers. */
  meta: boolean;
};

export type ParsedDialog = {
  kind: "permission" | "question";
  prompt: string;
  context: string[];
  options: DialogOption[];
  multiSelect: boolean;
};

/** A row can be prefixed by the cursor or, in a menu that scrolls, by the more-above/below arrow. */
const OPTION_LINE = /^\s*([❯↑↓]\s*)?(\d+)\.\s+(.*\S)\s*$/;
const CHECKBOX = /^\[(.)\]\s*(.*)$/;
const DIVIDER = /^[─—_]{4,}$/;
const TAB_BAR = /^[←→]|[☐☒]|✔\s*Submit/;
const SELECT_FOOTER = /Enter to select|Enter to confirm|↑\/↓ to navigate/i;
/** A menu long enough to scroll pushes its footer off the screen, so its heading has to identify it. */
const MENU_HEADING = /^\s*(Select|Choose|Toggle) \S+/m;
const PERMISSION_FOOTER = /Tab to amend|ctrl\+e to explain/i;
const PERMISSION_PROMPT = /Do you want to (proceed|allow|use)|requires approval/i;
const META_OPTIONS = /^(type something|chat about this|submit(\s+answers)?|cancel)\.?$/i;

function stripPadding(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\s+$/, ""));
}

/**
 * Reads the option dialog off the terminal screen.
 * The CLI's exact layout changes between versions, so every caller must handle `null` by pointing
 * the user at the terminal rather than guessing.
 */
export function parseDialog(rawLines: string[]): ParsedDialog | null {
  const lines = stripPadding(rawLines);
  const screen = lines.join("\n");
  const isQuestion = SELECT_FOOTER.test(screen) || MENU_HEADING.test(screen);
  const isPermission = PERMISSION_FOOTER.test(screen) || PERMISSION_PROMPT.test(screen);
  if (!isQuestion && !isPermission) return null;

  const options: DialogOption[] = [];
  let firstOptionLine = -1;
  let expected = 1;
  let sawCheckbox = false;
  for (let index = 0; index < lines.length; index += 1) {
    const match = OPTION_LINE.exec(lines[index]!);
    if (!match) continue;
    const number = Number.parseInt(match[2]!, 10);
    if (number !== expected) {
      if (number !== 1) continue;
      // A newer dialog further down the screen replaces whatever was parsed above it.
      options.length = 0;
      expected = 1;
    }
    if (options.length === 0) firstOptionLine = index;
    let label = match[3]!;
    let checked = false;
    const checkbox = CHECKBOX.exec(label);
    if (checkbox) {
      sawCheckbox = true;
      checked = checkbox[1]!.trim() !== "";
      label = checkbox[2]!.trim();
    }
    const columns = label.split(/\s{2,}/);
    const description = columns.length > 1 ? columns.slice(1).join(" ").trim() : null;
    label = columns[0]!.trim();
    options.push({
      index: number,
      label,
      description: description === "" ? null : description,
      checked,
      meta: META_OPTIONS.test(label),
    });
    expected = number + 1;
  }
  if (options.length === 0) return null;

  const context: string[] = [];
  for (let index = firstOptionLine - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    if (DIVIDER.test(line)) break;
    if (TAB_BAR.test(line)) continue;
    context.unshift(line);
    if (context.length >= 6) break;
  }
  // A menu names itself in its heading, so the wrapped blurb underneath stays context.
  const headingAt = context.findIndex((line) => MENU_HEADING.test(line));
  const prompt = headingAt >= 0 ? context.splice(headingAt, 1)[0]! : (context.pop() ?? "");

  return {
    kind: isPermission ? "permission" : "question",
    prompt,
    context,
    options,
    multiSelect: sawCheckbox,
  };
}

/**
 * The permission modes the CLI cycles through with Shift+Tab, in cycle order.
 * `bypassPermissions` and `auto` are only in the cycle when the session allows them.
 */
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions", "auto"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** What each mode writes below the prompt; the default mode may write nothing at all. */
const MODE_MARKERS: [PermissionMode, RegExp][] = [
  ["default", /manual mode on/i],
  ["acceptEdits", /accept edits on/i],
  ["plan", /plan mode on/i],
  ["auto", /auto mode on/i],
  ["bypassPermissions", /bypass permissions mode|bypassing permissions/i],
];

/**
 * Reads the mode off the terminal footer.
 * Returns null when the screen is not an interactive CLI at all, so that "no marker" can mean the
 * default mode rather than "unknown".
 */
export function parsePermissionMode(rawLines: string[]): PermissionMode | null {
  const screen = stripPadding(rawLines).join("\n");
  for (const [mode, marker] of MODE_MARKERS) {
    if (marker.test(screen)) return mode;
  }
  return looksLikeClaudeSession(rawLines) ? "default" : null;
}
