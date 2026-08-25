/**
 * The text the CLI ends up with, which the panel needs too: it echoes a sent prompt before the
 * transcript has caught up, and the echo has to read like the line the transcript will hold.
 */
export function composePrompt(text: string, references: string[]): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (references.length === 0) return normalized;
  // An attachment reaches the CLI as a line of its own: a path it reads, or a URL it fetches.
  return [normalized, ...references].filter((part) => part !== "").join("\n");
}
