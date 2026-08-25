import { randomUUID } from "node:crypto";
import {
  looksLikeClaudeSession,
  parseDialog,
  parsePermissionMode,
  type ParsedDialog,
  type PermissionMode,
} from "./capture.server.ts";
import {
  answerKeys,
  FAST_MODE_TOGGLE,
  metaOptionKeys,
  MODEL_MENU,
  PASTE_END,
  PASTE_START,
  SHIFT_TAB,
  THINKING_TOGGLE,
} from "./keymap.server.ts";
import {
  captureTerminal,
  createTerminal,
  listTerminals,
  sendKeys,
  type TerminalRow,
} from "./paseo-cli.server.ts";
import type { SendBehavior } from "./state.server.ts";

const TERMINAL_NAME = "Claude Code";
const ANSWER_KEY_GAP_MS = 120;
const LAUNCH_CHECK_MS = 1500;
const ANSWER_VERIFY_MS = 700;
const IDLE_WAIT_TIMEOUT_MS = 120_000;
const IDLE_POLL_MS = 750;
const INTERRUPT_SETTLE_MS = 300;
const SUBMIT_SETTLE_MS = 150;
const MENU_SETTLE_MS = 400;
const MODE_SETTLE_MS = 250;
/** One full trip around the cycle, which is as far as Shift+Tab can ever need to go. */
const MODE_CYCLE_LIMIT = 5;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Starting the interactive CLI (rather than `claude -p` or the SDK) is the point of this plugin:
 * usage accounting stays normal and the session syncs to the Claude apps.
 * The session id is generated here so the terminal maps onto exactly one transcript file.
 */
export type StartedSession = { sessionId: string; terminalId: string; warning: string | null };

/** `claude` runs in the user's shell, so a missing binary only shows up on the terminal screen. */
async function launchWarning(terminalId: string): Promise<string | null> {
  await delay(LAUNCH_CHECK_MS);
  try {
    const screen = (await captureTerminal(terminalId)).join("\n");
    if (/command not found|not recognized as an internal|No such file or directory/i.test(screen)) {
      return "the terminal could not start `claude` — check that it is on your PATH";
    }
  } catch {
    return null;
  }
  return null;
}

async function launch(workspaceDir: string, command: string, sessionId: string): Promise<StartedSession> {
  const terminal = await createTerminal(workspaceDir, TERMINAL_NAME);
  await sendKeys(terminal.id, [command], true);
  await sendKeys(terminal.id, ["Enter"]);
  return { sessionId, terminalId: terminal.id, warning: await launchWarning(terminal.id) };
}

export async function startSession(workspaceDir: string): Promise<StartedSession> {
  const sessionId = randomUUID();
  return launch(workspaceDir, `claude --session-id ${sessionId}`, sessionId);
}

export async function resumeSession(workspaceDir: string, sessionId: string): Promise<StartedSession> {
  return launch(workspaceDir, `claude --resume ${sessionId}`, sessionId);
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

export async function readDialog(terminalId: string): Promise<ParsedDialog | null> {
  return parseDialog(await captureTerminal(terminalId));
}

/** Maps the option labels the panel rendered onto the digits the CLI is currently showing. */
export function optionIndicesForLabels(dialog: ParsedDialog, labels: string[]): number[] {
  const indices: number[] = [];
  for (const label of labels) {
    const wanted = label.trim().toLowerCase();
    const match = dialog.options.find((option) => option.label.trim().toLowerCase() === wanted);
    if (match) indices.push(match.index);
  }
  return indices;
}

export type AnswerResult = {
  answered: boolean;
  verified: boolean;
  warning: string | null;
  note: string | null;
};

export async function answerDialog(options: {
  terminalId: string;
  dialog: ParsedDialog;
  optionIndices: number[];
}): Promise<AnswerResult> {
  const chosen = options.dialog.options.filter((option) => options.optionIndices.includes(option.index));
  const meta = chosen.length === 1 && chosen[0]!.meta ? chosen[0]! : null;
  const keys = meta ? metaOptionKeys(meta.index) : answerKeys(options.optionIndices, options.dialog.multiSelect);
  if (keys.length === 0) {
    return { answered: false, verified: false, warning: "no option to send", note: null };
  }
  for (const key of keys) {
    await sendKeys(options.terminalId, [key], true);
    await delay(ANSWER_KEY_GAP_MS);
  }
  if (meta) {
    return {
      answered: true,
      verified: true,
      warning: null,
      note: `"${meta.label}" is open in the terminal — type your reply in the prompt box below.`,
    };
  }

  await delay(ANSWER_VERIFY_MS);
  const remaining = await readDialog(options.terminalId);
  if (remaining && remaining.prompt === options.dialog.prompt) {
    return {
      answered: true,
      verified: false,
      warning: "the dialog is still on screen — answer it in the terminal",
      note: null,
    };
  }
  return { answered: true, verified: true, warning: null, note: null };
}

/**
 * Opens one of the CLI's own menus: Alt+P lists the models and the effort levels, Alt+T the thinking
 * setting. The panel does not reimplement either; it reads the menu back off the screen.
 */
export async function openCliMenu(terminalId: string, menu: "model" | "thinking"): Promise<void> {
  await sendKeys(terminalId, [menu === "model" ? MODEL_MENU : THINKING_TOGGLE], true);
  await delay(MENU_SETTLE_MS);
}

/** Alt+O opens a confirmation rather than a menu: Tab flips the switch and Enter commits it. */
export async function toggleFastMode(terminalId: string): Promise<void> {
  await sendKeys(terminalId, [FAST_MODE_TOGGLE], true);
  await delay(MENU_SETTLE_MS);
  await sendKeys(terminalId, ["Tab"]);
  await delay(MODE_SETTLE_MS);
  await sendKeys(terminalId, ["Enter"]);
  await delay(MODE_SETTLE_MS);
}

export async function readPermissionMode(terminalId: string): Promise<PermissionMode | null> {
  return parsePermissionMode(await captureTerminal(terminalId));
}

export type ModeResult = { mode: PermissionMode | null; warning: string | null };

/**
 * Shift+Tab is the only way to change mode, and which modes are in the cycle depends on the session,
 * so the target is reached by stepping and re-reading the screen rather than by counting presses.
 */
export async function setPermissionMode(
  terminalId: string,
  target: PermissionMode,
): Promise<ModeResult> {
  let mode = await readPermissionMode(terminalId);
  if (mode === null) return { mode: null, warning: "the terminal is not showing an interactive CLI" };
  for (let step = 0; step < MODE_CYCLE_LIMIT && mode !== target; step += 1) {
    await sendKeys(terminalId, [SHIFT_TAB], true);
    await delay(MODE_SETTLE_MS);
    mode = await readPermissionMode(terminalId);
  }
  if (mode !== target) {
    return { mode, warning: `this session does not offer ${target} — Shift+Tab in the terminal to change it` };
  }
  return { mode, warning: null };
}
