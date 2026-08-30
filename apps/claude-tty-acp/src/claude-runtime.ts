import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSideConnection, ContentBlock, PromptResponse } from "@agentclientprotocol/sdk";
import * as nodePty from "node-pty";
import { createDeferred, type Deferred } from "./deferred.ts";
import { type HookPayload, type HookRegistration, type HookResponse, HookServer } from "./hook-server.ts";
import { InteractionBridge } from "./interactions.ts";
import { writeLog } from "./log.ts";
import { cleanupPromptFiles, materializePrompt } from "./prompt-content.ts";
import { markRuntimeDirectory, runtimePrefix } from "./runtime-directories.ts";
import { INHERIT_MODEL_ID } from "./session-options.ts";
import { TerminalScreen } from "./terminal-screen.ts";
import { TranscriptReader } from "./transcript-reader.ts";
import { TranscriptTranslator } from "./transcript-translator.ts";
import { TranscriptWatcher } from "./transcript-watcher.ts";

const STARTUP_TIMEOUT_MS = 15_000;
// Paseo replaces a prompt sent mid-turn by cancelling the running turn and waiting 2s for session/prompt to answer, then starts the replacement anyway and fails it when the old turn is still open.
// This fallback plus the transcript flush behind it has to settle well inside that budget.
const CANCEL_TIMEOUT_MS = 600;
const SUBMIT_DELAY_MS = 150;
// Claude drops the submit key while it is still settling a paste, so the prompt is re-submitted until its input box lets go of it.
const SUBMIT_ATTEMPTS = 6;
const SUBMIT_CONFIRM_MS = 400;
const PASTE_ECHO_MS = 300;
const PROMPT_ECHO_CHARS = 40;
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";
// Claude keeps its completion menu open while the cursor sits at the end of an @mention or a /command, and the submit key then picks an entry instead of sending the prompt.
// A trailing space closes the menu, so every paste ends with one.
const COMPLETION_DISMISS = " ";
const ESCAPE = "\u001b";
const CARRIAGE_RETURN = "\r";
const CONTROL_D = "\u0004";

type PtyProcess = Pick<nodePty.IPty, "pid" | "write" | "kill" | "onData" | "onExit">;
type SpawnPty = (file: string, args: string[], options: nodePty.IPtyForkOptions) => PtyProcess;

export type RuntimeDependencies = {
  spawnPty?: SpawnPty;
  startupTimeoutMs?: number;
  readinessTimeoutMs?: number;
  cancelTimeoutMs?: number;
  submitDelayMs?: number;
  transcriptPollIntervalMs?: number;
  runtimeRoot?: string;
  claudeConfigDir?: string;
  transcriptFilePath?: string;
  stateDirectory?: string;
  translator?: TranscriptTranslator;
  resume?: boolean;
  model?: string;
  mode?: string;
  onClaudeSessionChange?: (claudeSessionId: string) => Promise<void>;
};

type TurnResult = {
  response: PromptResponse;
  assistantMessage?: string;
};

export class ClaudeRuntime {
  readonly sessionId: string;
  readonly cwd: string;
  private currentClaudeSessionId: string;
  private readonly spawnPty: SpawnPty;
  private readonly startupTimeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly cancelTimeoutMs: number;
  private readonly submitDelayMs: number;
  private readonly transcriptPollIntervalMs: number | undefined;
  private readonly runtimeRoot: string;
  private readonly connection: AgentSideConnection;
  private readonly hooks: HookServer;
  private readonly claudeConfigDir: string | undefined;
  private readonly initialTranscriptFilePath: string | undefined;
  private resumeNextLaunch: boolean;
  private model: string;
  private mode: string;
  private readonly onClaudeSessionChange: ((claudeSessionId: string) => Promise<void>) | undefined;
  private readonly interactions: InteractionBridge;
  private readonly translator: TranscriptTranslator;
  private transcript: TranscriptWatcher;
  private readonly screen = new TerminalScreen();
  private pty: PtyProcess | null = null;
  private runtimeDirectory: string | null = null;
  private hookRegistration: HookRegistration | null = null;
  private ready: Deferred<void> | null = null;
  private turn: Deferred<TurnResult> | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;
  private cancelRequested = false;
  private assistantBaseline = 0;
  private closed = false;
  private intentionalExit: Deferred<void> | null = null;

  constructor(
    sessionId: string,
    claudeSessionId: string,
    cwd: string,
    connection: AgentSideConnection,
    hooks: HookServer,
    dependencies: RuntimeDependencies = {},
  ) {
    this.sessionId = sessionId;
    this.currentClaudeSessionId = claudeSessionId;
    this.cwd = cwd;
    this.connection = connection;
    this.hooks = hooks;
    this.claudeConfigDir = dependencies.claudeConfigDir;
    this.initialTranscriptFilePath = dependencies.transcriptFilePath;
    this.resumeNextLaunch = dependencies.resume === true;
    this.model = dependencies.model ?? INHERIT_MODEL_ID;
    this.mode = dependencies.mode ?? "default";
    this.onClaudeSessionChange = dependencies.onClaudeSessionChange;
    this.interactions = new InteractionBridge(sessionId, cwd, connection);
    this.spawnPty = dependencies.spawnPty ?? nodePty.spawn;
    this.startupTimeoutMs = dependencies.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.readinessTimeoutMs = dependencies.readinessTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.cancelTimeoutMs = dependencies.cancelTimeoutMs ?? CANCEL_TIMEOUT_MS;
    this.submitDelayMs = dependencies.submitDelayMs ?? SUBMIT_DELAY_MS;
    this.transcriptPollIntervalMs = dependencies.transcriptPollIntervalMs;
    this.runtimeRoot = dependencies.runtimeRoot ?? os.tmpdir();
    this.translator = dependencies.translator ?? new TranscriptTranslator(sessionId, cwd, connection);
    this.transcript = this.createTranscriptWatcher(claudeSessionId, dependencies.transcriptFilePath);
  }

  get started(): boolean {
    return this.pty !== null;
  }

  get turnActive(): boolean {
    return this.turn !== null;
  }

  async prompt(content: ContentBlock[]): Promise<PromptResponse> {
    if (this.closed) throw new Error(`Session ${this.sessionId} is closed`);
    if (this.turn) throw new Error(`Session ${this.sessionId} already has an active turn`);
    await this.ensureStarted();
    if (!this.runtimeDirectory) throw new Error(`Session ${this.sessionId} has no runtime directory`);
    const prompt = await materializePrompt(content, this.runtimeDirectory, this.cwd);
    const turn = createDeferred<TurnResult>();
    this.turn = turn;
    this.cancelRequested = false;
    this.interactions.beginTurn();
    this.assistantBaseline = this.translator.assistantChunks;
    await this.submit(prompt.text);
    try {
      const result = await turn.promise;
      if (result.assistantMessage) {
        this.translator.suppressNextAssistantText(result.assistantMessage);
        await this.connection.sessionUpdate({
          sessionId: this.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: randomUUID(),
            content: { type: "text", text: result.assistantMessage },
          },
        });
      }
      return result.response;
    } finally {
      await cleanupPromptFiles(prompt.files);
    }
  }

  async reconfigure(model: string, mode: string): Promise<void> {
    if (this.turn) throw new Error("Cannot change Claude model or mode during an active turn");
    this.model = model;
    this.mode = mode;
    if (!this.pty) return;
    await this.stopForRestart();
    await this.ensureStarted();
  }

  cancel(): void {
    const turn = this.turn;
    if (!turn) return;
    this.cancelRequested = true;
    this.interactions.cancelPending();
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    if (!this.pty) {
      this.cancelTimer = null;
      void this.finishCancelled();
      return;
    }
    this.pty.write(ESCAPE);
    this.cancelTimer = setTimeout(() => void this.finishCancelled(), this.cancelTimeoutMs);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = null;
    this.ready?.reject(new Error(`Session ${this.sessionId} closed before Claude became ready`));
    this.ready = null;
    this.intentionalExit?.resolve();
    this.intentionalExit = null;
    this.finishTurn({ response: { stopReason: "cancelled" } });
    this.interactions.cancelPending();
    this.hookRegistration?.unregister();
    this.hookRegistration = null;
    const pty = this.pty;
    this.pty = null;
    if (pty) {
      try {
        pty.kill();
      } catch (error) {
        writeLog({ level: "warn", message: "Failed to stop Claude PTY", sessionId: this.sessionId, error: errorMessage(error) });
      }
    }
    await this.transcript.close();
    this.screen.dispose();
    await this.removeRuntimeDirectory();
  }

  private async ensureStarted(): Promise<void> {
    if (this.pty) return;
    this.screen.reset();
    await this.hooks.start();
    this.runtimeDirectory = await mkdtemp(runtimePrefix(this.runtimeRoot));
    await chmod(this.runtimeDirectory, 0o700);
    await markRuntimeDirectory(this.runtimeDirectory);
    this.hookRegistration = this.hooks.register(this.currentClaudeSessionId, (payload) => this.handleHook(payload));
    const hookClientPath = path.join(this.runtimeDirectory, "hook-client.mjs");
    await writeFile(hookClientPath, hookClientSource(this.hookRegistration.endpoint), { mode: 0o600 });
    const settingsPath = path.join(this.runtimeDirectory, "settings.json");
    const hookCommand = `${shellQuote(process.execPath)} ${shellQuote(hookClientPath)}`;
    await writeFile(settingsPath, `${JSON.stringify(createHookSettings(hookCommand))}\n`, { mode: 0o600 });
    this.ready = createDeferred<void>();
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const sessionArgs = this.resumeNextLaunch
      ? ["--resume", this.currentClaudeSessionId]
      : ["--session-id", this.currentClaudeSessionId];
    try {
      this.pty = this.spawnPty(claudeBin, [...sessionArgs, ...selectionArgs(this.model, this.mode), "--settings", settingsPath], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: this.cwd,
        env: process.env,
      });
    } catch (error) {
      await this.failedStartup(`Could not start ${claudeBin}: ${errorMessage(error)}`);
    }
    this.pty?.onData((data) => this.screen.write(data));
    this.pty?.onExit(({ exitCode, signal }) => this.handleExit(exitCode, signal));
    try {
      await withTimeout(
        this.ready.promise,
        this.startupTimeoutMs,
        `Claude did not complete the SessionStart hook handshake within ${this.startupTimeoutMs}ms. Check Claude hook policy and the terminal output:\n${this.screen.snapshot()}`,
      );
    } catch (error) {
      await this.failedStartup(errorMessage(error));
    } finally {
      this.ready = null;
    }
    await this.waitForTerminalReady();
    await this.transcript.start();
    this.resumeNextLaunch = true;
    writeLog({ level: "info", message: "Started interactive Claude session", sessionId: this.sessionId, pid: this.pty?.pid, cwd: this.cwd });
  }

  private async failedStartup(message: string): Promise<never> {
    this.hookRegistration?.unregister();
    this.hookRegistration = null;
    const pty = this.pty;
    this.pty = null;
    if (pty) {
      try {
        pty.kill();
      } catch {}
    }
    await this.removeRuntimeDirectory();
    throw new Error(message);
  }

  private async handleHook(payload: HookPayload): Promise<HookResponse> {
    switch (payload.hook_event_name) {
      // Hooks arrive over their own channel, ahead of the transcript the watcher is still polling.
      // Draining first keeps the prompt from landing before the assistant text that explains it.
      case "PreToolUse":
        await this.transcript.flushUntilStable();
        return this.interactions.handlePreToolUse(payload);
      case "PermissionRequest":
        await this.transcript.flushUntilStable();
        return this.interactions.handlePermissionRequest(payload);
      case "SessionStart":
        await this.handleSessionStart(payload);
        this.ready?.resolve();
        break;
      case "Stop":
        await this.transcript.flushUntilStable();
        this.finishTurn(
          this.cancelRequested
            ? { response: { stopReason: "cancelled" } }
            : {
                response: { stopReason: "end_turn" },
                assistantMessage: this.translator.assistantChunks === this.assistantBaseline ? asString(payload.last_assistant_message) : undefined,
              },
        );
        break;
      case "StopFailure":
        await this.transcript.flushUntilStable();
        this.finishTurn(
          this.cancelRequested
            ? { response: { stopReason: "cancelled" } }
            : {
                response: { stopReason: "refusal" },
                assistantMessage:
                  this.translator.assistantChunks === this.assistantBaseline
                    ? asString(payload.last_assistant_message) || asString(payload.error) || "Claude could not complete the turn."
                    : undefined,
              },
        );
        break;
      case "SessionEnd":
        await this.transcript.flushUntilStable();
        this.finishTurn({ response: { stopReason: "cancelled" } });
        break;
    }
    return {};
  }

  private handleExit(exitCode: number, signal?: number): void {
    if (this.closed) return;
    if (this.intentionalExit) {
      this.pty = null;
      this.intentionalExit.resolve();
      return;
    }
    const details = this.screen.snapshot();
    const error = new Error(`Claude PTY exited unexpectedly with code ${exitCode}${signal === undefined ? "" : ` and signal ${signal}`}.${details ? `\n${details}` : ""}`);
    this.ready?.reject(error);
    if (this.turn) {
      const turn = this.turn;
      this.turn = null;
      turn.reject(error);
    }
    this.pty = null;
    this.hookRegistration?.unregister();
    this.hookRegistration = null;
    void this.transcript.close().catch((transcriptError) => {
      writeLog({ level: "warn", message: "Failed to stop Claude transcript watcher", sessionId: this.sessionId, error: errorMessage(transcriptError) });
    });
    void this.removeRuntimeDirectory().catch((cleanupError) => {
      writeLog({ level: "warn", message: "Failed to remove Claude runtime directory", sessionId: this.sessionId, error: errorMessage(cleanupError) });
    });
  }

  private finishTurn(result: TurnResult): void {
    if (!this.turn) return;
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = null;
    this.cancelRequested = false;
    this.interactions.cancelPending();
    const turn = this.turn;
    this.turn = null;
    turn.resolve(result);
  }

  private async finishCancelled(): Promise<void> {
    await this.transcript.flushUntilStable();
    this.finishTurn({ response: { stopReason: "cancelled" } });
  }

  private async handleSessionStart(payload: HookPayload): Promise<void> {
    const nextClaudeSessionId = asString(payload.session_id);
    const transcriptFilePath = asString(payload.transcript_path);
    const source = asString(payload.source);
    if (source === "clear" && nextClaudeSessionId && nextClaudeSessionId !== this.currentClaudeSessionId) {
      await this.transcript.close();
      this.currentClaudeSessionId = nextClaudeSessionId;
      this.hookRegistration?.addSessionId(nextClaudeSessionId);
      this.transcript = this.createTranscriptWatcher(nextClaudeSessionId, transcriptFilePath);
      await this.transcript.start();
      await this.onClaudeSessionChange?.(nextClaudeSessionId);
      return;
    }
    if (transcriptFilePath && transcriptFilePath !== this.initialTranscriptFilePath) {
      await this.transcript.close();
      this.transcript = this.createTranscriptWatcher(this.currentClaudeSessionId, transcriptFilePath);
    }
  }

  private createTranscriptWatcher(claudeSessionId: string, filePath?: string): TranscriptWatcher {
    return new TranscriptWatcher(
      new TranscriptReader(claudeSessionId, this.cwd, { configDir: this.claudeConfigDir, filePath }),
      this.translator,
      this.transcriptPollIntervalMs,
    );
  }

  private async removeRuntimeDirectory(): Promise<void> {
    const directory = this.runtimeDirectory;
    this.runtimeDirectory = null;
    if (directory) await rm(directory, { force: true, recursive: true });
  }

  private async stopForRestart(): Promise<void> {
    const pty = this.pty;
    if (!pty) return;
    this.intentionalExit = createDeferred<void>();
    pty.write(CONTROL_D);
    await Promise.race([this.intentionalExit.promise, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    if (this.pty === pty) {
      try {
        pty.kill();
      } catch {}
      this.pty = null;
      await Promise.race([this.intentionalExit.promise, new Promise<void>((resolve) => setTimeout(resolve, 50))]);
    }
    this.intentionalExit = null;
    this.hookRegistration?.unregister();
    this.hookRegistration = null;
    await this.transcript.close();
    await this.removeRuntimeDirectory();
  }

  private async submit(text: string): Promise<void> {
    this.pty?.write(`${BRACKETED_PASTE_START}${text}${COMPLETION_DISMISS}${BRACKETED_PASTE_END}`);
    const echo = promptEcho(text);
    const pasted = await this.screenSettles((screen) => inputBoxHolds(screen, echo), PASTE_ECHO_MS);
    for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt += 1) {
      await delay(this.submitDelayMs);
      if (this.cancelRequested) return;
      this.pty?.write(CARRIAGE_RETURN);
      if (!pasted) return;
      if (await this.screenSettles((screen) => !inputBoxHolds(screen, echo), SUBMIT_CONFIRM_MS)) return;
    }
    writeLog({ level: "warn", message: "Claude kept the prompt in its input box after every submit attempt", sessionId: this.sessionId });
  }

  private async screenSettles(predicate: (screen: string) => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (predicate(this.screen.snapshot())) return true;
      await delay(25);
    } while (Date.now() < deadline);
    return false;
  }

  private async waitForTerminalReady(): Promise<void> {
    if (this.readinessTimeoutMs === 0) return;
    const deadline = Date.now() + this.readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (isReadyScreen(this.screen.snapshot())) return;
      await delay(25);
    }
    await this.failedStartup(`Claude completed its SessionStart hook but its interactive prompt did not become ready within ${this.readinessTimeoutMs}ms. Check the terminal output:\n${this.screen.snapshot()}`);
  }
}

function createHookSettings(command: string): Record<string, unknown> {
  const lifecycleHook = { type: "command", command, timeout: 30 };
  const interactionHook = { type: "command", command, timeout: 600 };
  return {
    hooks: {
      PreToolUse: [{ hooks: [interactionHook] }],
      PermissionRequest: [{ hooks: [interactionHook] }],
      SessionStart: [{ hooks: [lifecycleHook] }],
      Stop: [{ hooks: [lifecycleHook] }],
      StopFailure: [{ hooks: [lifecycleHook] }],
      SessionEnd: [{ hooks: [lifecycleHook] }],
    },
  };
}

function hookClientSource(endpoint: string): string {
  return `const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const response = await fetch(${JSON.stringify(endpoint)}, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
const body = await response.text();
if (body) process.stdout.write(body);
if (!response.ok) process.exitCode = 1;
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function selectionArgs(model: string, mode: string): string[] {
  const args: string[] = [];
  if (model !== INHERIT_MODEL_ID) args.push("--model", model);
  if (mode !== "default") args.push("--permission-mode", mode);
  return args;
}

function promptEcho(text: string): string {
  return text.trim().split("\n", 1)[0]!.trim().slice(0, PROMPT_ECHO_CHARS);
}

// The last prompt marker on screen is Claude's input box; the ones above it are prompts it has already taken.
function inputBoxHolds(screen: string, echo: string): boolean {
  const lines = screen.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^\s*❯\s?(.*)$/.exec(lines[index]!);
    if (match) return match[1]!.trim().startsWith(echo);
  }
  return false;
}

function isReadyScreen(screen: string): boolean {
  return /\?\s+for shortcuts|\d+(?:\.\d+)?[km]?\/\d+(?:\.\d+)?[km]? tokens|(?:auto|plan|accept edits|manual) mode on|(^|\n)\s*❯\s*($|\n)/i.test(screen);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
