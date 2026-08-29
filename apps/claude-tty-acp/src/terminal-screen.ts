import { createRequire } from "node:module";
import type { Terminal as XtermTerminal } from "@xterm/headless";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as { Terminal: typeof XtermTerminal };

export class TerminalScreen {
  private readonly terminal: XtermTerminal = new Terminal({ allowProposedApi: true, cols: 120, rows: 40, scrollback: 500 });

  write(data: string): void {
    this.terminal.write(data);
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
    this.terminal.reset();
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
