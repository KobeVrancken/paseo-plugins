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

const OPTION_LINE = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const CHECKBOX = /^\[(.)\]\s*(.*)$/;
const DIVIDER = /^[─—_]{4,}$/;
const TAB_BAR = /^[←→]|[☐☒]|✔\s*Submit/;
const SELECT_FOOTER = /Enter to select|↑\/↓ to navigate/i;
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
  const isQuestion = SELECT_FOOTER.test(screen);
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
    options.push({ index: number, label, checked, meta: META_OPTIONS.test(label) });
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
  const prompt = context.pop() ?? "";

  return {
    kind: isPermission ? "permission" : "question",
    prompt,
    context,
    options,
    multiSelect: sawCheckbox,
  };
}
