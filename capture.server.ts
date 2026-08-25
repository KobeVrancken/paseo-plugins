/** Markers of an interactive Claude Code CLI screen; used to guess which terminal a session runs in. */
const CLAUDE_MARKERS = [
  /\?\s+for shortcuts/i,
  /esc to interrupt/i,
  /(auto|plan|accept edits) mode on/i,
  /\d+(\.\d+)?[km]?\/\d+(\.\d+)?[km]? tokens/i,
];

export function looksLikeClaudeSession(lines: string[]): boolean {
  const screen = lines.join("\n");
  return CLAUDE_MARKERS.some((marker) => marker.test(screen));
}
