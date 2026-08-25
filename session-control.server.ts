import { randomUUID } from "node:crypto";
import { looksLikeClaudeSession } from "./capture.server.ts";
import {
  captureTerminal,
  createTerminal,
  listTerminals,
  sendKeys,
  type TerminalRow,
} from "./paseo-cli.server.ts";
import type { SendBehavior } from "./state.server.ts";

const ESC = String.fromCharCode(27);
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

const TERMINAL_NAME = "Claude Code";
const IDLE_WAIT_TIMEOUT_MS = 120_000;
const IDLE_POLL_MS = 750;
const INTERRUPT_SETTLE_MS = 300;
const SUBMIT_SETTLE_MS = 150;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Starting the interactive CLI (rather than `claude -p` or the SDK) is the point of this plugin:
 * usage accounting stays normal and the session syncs to the Claude apps.
 * The session id is generated here so the terminal maps onto exactly one transcript file.
 */
export async function startSession(workspaceDir: string): Promise<{ sessionId: string; terminalId: string }> {
  const sessionId = randomUUID();
  const terminal = await createTerminal(workspaceDir, TERMINAL_NAME);
  await sendKeys(terminal.id, [`claude --session-id ${sessionId}`], true);
  await sendKeys(terminal.id, ["Enter"]);
  return { sessionId, terminalId: terminal.id };
}

export async function resumeSession(
  workspaceDir: string,
  sessionId: string,
): Promise<{ sessionId: string; terminalId: string }> {
  const terminal = await createTerminal(workspaceDir, TERMINAL_NAME);
  await sendKeys(terminal.id, [`claude --resume ${sessionId}`], true);
  await sendKeys(terminal.id, ["Enter"]);
  return { sessionId, terminalId: terminal.id };
}

export type AttachableTerminal = TerminalRow & { looksLikeClaude: boolean };

export async function listAttachableTerminals(workspaceDir: string): Promise<AttachableTerminal[]> {
  const terminals = await listTerminals(workspaceDir);
  return Promise.all(
    terminals.map(async (terminal) => {
      let looksLikeClaude = false;
      try {
        looksLikeClaude = looksLikeClaudeSession(await captureTerminal(terminal.id));
      } catch {
        looksLikeClaude = false;
      }
      return { ...terminal, looksLikeClaude };
    }),
  );
}

export async function terminalExists(terminalId: string): Promise<boolean> {
  const terminals = await listTerminals();
  return terminals.some((terminal) => terminal.id === terminalId);
}

export function composePrompt(text: string, imagePaths: string[]): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (imagePaths.length === 0) return normalized;
  // The CLI picks up image attachments from file paths written in the prompt.
  return [normalized, ...imagePaths].filter((part) => part !== "").join("\n");
}

export type SendPromptResult = { delivered: boolean; note: string | null };

export async function sendPrompt(options: {
  terminalId: string;
  text: string;
  imagePaths: string[];
  behavior: SendBehavior;
  readStatus: () => Promise<"idle" | "running" | "needs_input" | "detached">;
}): Promise<SendPromptResult> {
  const composed = composePrompt(options.text, options.imagePaths);
  if (composed === "") return { delivered: false, note: "nothing to send" };

  let note: string | null = null;

  if (options.behavior === "hold_until_idle") {
    const deadline = Date.now() + IDLE_WAIT_TIMEOUT_MS;
    let status = await options.readStatus();
    while (status === "running" && Date.now() < deadline) {
      await delay(IDLE_POLL_MS);
      status = await options.readStatus();
    }
    if (status === "running") note = "still busy after waiting — sent anyway";
  }

  if (options.behavior === "interrupt_first") {
    // Esc stops the current turn. Never Ctrl+C: it clears the input line and twice exits the CLI.
    await sendKeys(options.terminalId, ["Escape"]);
    await delay(INTERRUPT_SETTLE_MS);
  }

  if (composed.includes("\n")) {
    await sendKeys(options.terminalId, [PASTE_START, composed, PASTE_END], true);
  } else {
    await sendKeys(options.terminalId, [composed], true);
  }
  await delay(SUBMIT_SETTLE_MS);
  await sendKeys(options.terminalId, ["Enter"]);
  return { delivered: true, note };
}
