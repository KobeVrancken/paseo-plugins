import { createRequire } from "node:module";
import type { Terminal as XtermTerminal } from "@xterm/headless";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as { Terminal: typeof XtermTerminal };

export class TerminalScreen {
  private readonly terminal: XtermTerminal = new Terminal({ allowProposedApi: true, cols: 120, rows: 40, scrollback: 500 });
  private lastWriteAt = 0;

  write(data: string, callback?: () => void): void {
    this.lastWriteAt = Date.now();
    this.terminal.write(data, callback);
  }

  /** Claude paints continuously while it restores a conversation, so a screen that has stopped changing is the signal that it has finished. */
  quietFor(milliseconds: number): boolean {
    return Date.now() - this.lastWriteAt >= milliseconds;
  }

  snapshot(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const firstLine = Math.max(0, buffer.length - 40);
    for (let index = firstLine; index < buffer.length; index += 1) {
      const text = buffer.getLine(index)?.translateToString(true).trimEnd() ?? "";
      if (text) lines.push(text);
    }
    return lines.join("\n").slice(-8_000);
  }

  reset(): void {
    this.lastWriteAt = Date.now();
    this.terminal.reset();
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
