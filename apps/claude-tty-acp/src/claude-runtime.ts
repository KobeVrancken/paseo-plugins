import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSideConnection, ContentBlock, PromptResponse } from "@agentclientprotocol/sdk";
import * as nodePty from "node-pty";
import { createDeferred, type Deferred } from "./deferred.ts";
import { type HookPayload, type HookResponse, HookServer } from "./hook-server.ts";
import { writeLog } from "./log.ts";
import { TerminalScreen } from "./terminal-screen.ts";

const STARTUP_TIMEOUT_MS = 15_000;
const CANCEL_TIMEOUT_MS = 2_000;
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";
const ESCAPE = "\u001b";

type PtyProcess = Pick<nodePty.IPty, "pid" | "write" | "kill" | "onData" | "onExit">;
type SpawnPty = (file: string, args: string[], options: nodePty.IPtyForkOptions) => PtyProcess;

export type RuntimeDependencies = {
  spawnPty?: SpawnPty;
  startupTimeoutMs?: number;
  cancelTimeoutMs?: number;
  runtimeRoot?: string;
};

type TurnResult = {
  response: PromptResponse;
  assistantMessage?: string;
};

export class ClaudeRuntime {
  readonly sessionId: string;
  readonly cwd: string;
  private readonly spawnPty: SpawnPty;
  private readonly startupTimeoutMs: number;
  private readonly cancelTimeoutMs: number;
  private readonly runtimeRoot: string;
  private readonly connection: AgentSideConnection;
  private readonly hooks: HookServer;
  private readonly screen = new TerminalScreen();
  private pty: PtyProcess | null = null;
  private runtimeDirectory: string | null = null;
  private unregisterHook: (() => void) | null = null;
  private ready: Deferred<void> | null = null;
  private turn: Deferred<TurnResult> | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;
  private cancelRequested = false;
  private closed = false;

  constructor(
    sessionId: string,
    cwd: string,
    connection: AgentSideConnection,
    hooks: HookServer,
    dependencies: RuntimeDependencies = {},
  ) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.connection = connection;
    this.hooks = hooks;
    this.spawnPty = dependencies.spawnPty ?? nodePty.spawn;
    this.startupTimeoutMs = dependencies.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.cancelTimeoutMs = dependencies.cancelTimeoutMs ?? CANCEL_TIMEOUT_MS;
    this.runtimeRoot = dependencies.runtimeRoot ?? os.tmpdir();
  }

  get started(): boolean {
    return this.pty !== null;
  }

  async prompt(content: ContentBlock[]): Promise<PromptResponse> {
    if (this.closed) throw new Error(`Session ${this.sessionId} is closed`);
    if (this.turn) throw new Error(`Session ${this.sessionId} already has an active turn`);
    const prompt = promptText(content);
    await this.ensureStarted();
    const turn = createDeferred<TurnResult>();
    this.turn = turn;
    this.cancelRequested = false;
    this.pty?.write(`${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}\r`);
    const result = await turn.promise;
    if (result.assistantMessage) {
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
  }

  cancel(): void {
    const turn = this.turn;
    if (!turn) return;
    this.cancelRequested = true;
    this.pty?.write(ESCAPE);
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = setTimeout(() => this.finishTurn({ response: { stopReason: "cancelled" } }), this.cancelTimeoutMs);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = null;
    this.ready?.reject(new Error(`Session ${this.sessionId} closed before Claude became ready`));
    this.ready = null;
    this.finishTurn({ response: { stopReason: "cancelled" } });
    this.unregisterHook?.();
    this.unregisterHook = null;
    const pty = this.pty;
    this.pty = null;
    if (pty) {
      try {
        pty.kill();
      } catch (error) {
        writeLog({ level: "warn", message: "Failed to stop Claude PTY", sessionId: this.sessionId, error: errorMessage(error) });
      }
    }
    this.screen.dispose();
    await this.removeRuntimeDirectory();
  }

  private async ensureStarted(): Promise<void> {
    if (this.pty) return;
    const endpoint = await this.hooks.start();
    this.runtimeDirectory = await mkdtemp(path.join(this.runtimeRoot, "claude-tty-acp-"));
    await chmod(this.runtimeDirectory, 0o700);
    const settingsPath = path.join(this.runtimeDirectory, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify(createHookSettings(endpoint))}\n`, { mode: 0o600 });
    this.ready = createDeferred<void>();
    this.unregisterHook = this.hooks.register(this.sessionId, (payload) => this.handleHook(payload));
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    try {
      this.pty = this.spawnPty(claudeBin, ["--session-id", this.sessionId, "--settings", settingsPath], {
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
    writeLog({ level: "info", message: "Started interactive Claude session", sessionId: this.sessionId, pid: this.pty?.pid, cwd: this.cwd });
  }

  private async failedStartup(message: string): Promise<never> {
    this.unregisterHook?.();
    this.unregisterHook = null;
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
      case "SessionStart":
        this.ready?.resolve();
        break;
      case "Stop":
        this.finishTurn(
          this.cancelRequested
            ? { response: { stopReason: "cancelled" } }
            : { response: { stopReason: "end_turn" }, assistantMessage: asString(payload.last_assistant_message) },
        );
        break;
      case "StopFailure":
        this.finishTurn(
          this.cancelRequested
            ? { response: { stopReason: "cancelled" } }
            : {
                response: { stopReason: "refusal" },
                assistantMessage: asString(payload.last_assistant_message) || asString(payload.error) || "Claude could not complete the turn.",
              },
        );
        break;
      case "SessionEnd":
        this.finishTurn({ response: { stopReason: "cancelled" } });
        break;
    }
    return {};
  }

  private handleExit(exitCode: number, signal?: number): void {
    if (this.closed) return;
    const details = this.screen.snapshot();
    const error = new Error(`Claude PTY exited unexpectedly with code ${exitCode}${signal === undefined ? "" : ` and signal ${signal}`}.${details ? `\n${details}` : ""}`);
    this.ready?.reject(error);
    if (this.turn) {
      const turn = this.turn;
      this.turn = null;
      turn.reject(error);
    }
    this.pty = null;
    this.unregisterHook?.();
    this.unregisterHook = null;
    void this.removeRuntimeDirectory().catch((cleanupError) => {
      writeLog({ level: "warn", message: "Failed to remove Claude runtime directory", sessionId: this.sessionId, error: errorMessage(cleanupError) });
    });
  }

  private finishTurn(result: TurnResult): void {
    if (!this.turn) return;
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    this.cancelTimer = null;
    this.cancelRequested = false;
    const turn = this.turn;
    this.turn = null;
    turn.resolve(result);
  }

  private async removeRuntimeDirectory(): Promise<void> {
    const directory = this.runtimeDirectory;
    this.runtimeDirectory = null;
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}

function createHookSettings(endpoint: string): Record<string, unknown> {
  const hook = { type: "http", url: endpoint, timeout: 30 };
  return {
    hooks: {
      SessionStart: [{ hooks: [hook] }],
      Stop: [{ hooks: [hook] }],
      StopFailure: [{ hooks: [hook] }],
      SessionEnd: [{ hooks: [hook] }],
    },
  };
}

function promptText(content: ContentBlock[]): string {
  const unsupported = content.find((block) => block.type !== "text");
  if (unsupported) throw new Error(`ACP ${unsupported.type} prompt content is not supported until attachment handling is enabled`);
  const text = content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
  if (!text.trim()) throw new Error("Prompt must contain text");
  return text;
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
