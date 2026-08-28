import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentSideConnection, ContentBlock, PromptResponse } from "@agentclientprotocol/sdk";
import { ClaudeRuntime, type RuntimeDependencies } from "./claude-runtime.ts";
import { discoverCommands } from "./commands.ts";
import { HookServer } from "./hook-server.ts";
import { assertModeId, assertModelId, modeState, modelState } from "./session-options.ts";
import { SessionLock } from "./session-lock.ts";
import { type PersistedSession, StateStore } from "./state-store.ts";
import { TranscriptReader } from "./transcript-reader.ts";
import { TranscriptTranslator } from "./transcript-translator.ts";

type SessionOptions = {
  id: string;
  claudeSessionId: string;
  cwd: string;
  model: string;
  mode: string;
  persisted: boolean;
};

export class ClaudeSession {
  readonly id: string;
  readonly createdAt = Date.now();
  readonly cwd: string;
  private currentClaudeSessionId: string;
  private model: string;
  private mode: string;
  private persisted: boolean;
  private readonly connection: AgentSideConnection;
  private readonly hooks: HookServer;
  private readonly runtimeDependencies: RuntimeDependencies;
  private readonly stateStore: StateStore;
  private readonly lock: SessionLock;
  private readonly translator: TranscriptTranslator;
  private runtime: ClaudeRuntime | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    options: SessionOptions,
    connection: AgentSideConnection,
    hooks: HookServer,
    runtimeDependencies: RuntimeDependencies,
    stateStore: StateStore,
  ) {
    this.id = options.id;
    this.currentClaudeSessionId = options.claudeSessionId;
    this.cwd = options.cwd;
    this.model = options.model;
    this.mode = options.mode;
    this.persisted = options.persisted;
    this.connection = connection;
    this.hooks = hooks;
    this.runtimeDependencies = runtimeDependencies;
    this.stateStore = stateStore;
    this.lock = new SessionLock(this.id, stateStore.locksDirectory);
    this.translator = new TranscriptTranslator(this.id, this.cwd, connection);
  }

  get started(): boolean {
    return this.runtime?.started ?? false;
  }

  get models() {
    return modelState(this.model);
  }

  get modes() {
    return modeState(this.mode);
  }

  prompt(content: ContentBlock[]): Promise<PromptResponse> {
    return this.exclusive(async () => {
      await this.lock.acquire();
      const resume = this.persisted;
      await this.save();
      this.runtime ??= new ClaudeRuntime(this.id, this.currentClaudeSessionId, this.cwd, this.connection, this.hooks, {
        ...this.runtimeDependencies,
        resume,
        model: this.model,
        mode: this.mode,
        translator: this.translator,
        onClaudeSessionChange: async (claudeSessionId) => {
          this.currentClaudeSessionId = claudeSessionId;
          await this.save();
        },
      });
      return this.runtime.prompt(content);
    });
  }

  async replayHistory(): Promise<void> {
    await this.lock.acquire();
    const reader = new TranscriptReader(this.currentClaudeSessionId, this.cwd, { configDir: this.runtimeDependencies.claudeConfigDir });
    const result = await reader.read();
    await this.translator.translate(result.records);
  }

  async emitCommands(): Promise<void> {
    const availableCommands = await discoverCommands(this.cwd, this.runtimeDependencies.claudeConfigDir);
    await this.connection.sessionUpdate({
      sessionId: this.id,
      update: { sessionUpdate: "available_commands_update", availableCommands },
    });
  }

  setModel(model: string): Promise<void> {
    if (this.runtime?.turnActive) return Promise.reject(new Error("Cannot change Claude model during an active turn"));
    return this.exclusive(async () => {
      assertModelId(model);
      if (this.runtime?.turnActive) throw new Error("Cannot change Claude model during an active turn");
      if (this.model === model) return;
      this.model = model;
      if (this.persisted) await this.save();
      await this.runtime?.reconfigure(this.model, this.mode);
    });
  }

  setMode(mode: string): Promise<void> {
    if (this.runtime?.turnActive) return Promise.reject(new Error("Cannot change Claude mode during an active turn"));
    return this.exclusive(async () => {
      assertModeId(mode);
      if (this.runtime?.turnActive) throw new Error("Cannot change Claude mode during an active turn");
      if (this.mode === mode) return;
      this.mode = mode;
      if (this.persisted) await this.save();
      await this.runtime?.reconfigure(this.model, this.mode);
      await this.connection.sessionUpdate({ sessionId: this.id, update: { sessionUpdate: "current_mode_update", currentModeId: mode } });
    });
  }

  cancel(): void {
    this.runtime?.cancel();
  }

  async close(): Promise<void> {
    await this.runtime?.close();
    this.runtime = null;
    await this.lock.release();
  }

  private async save(): Promise<void> {
    const state: PersistedSession = {
      version: 1,
      acpSessionId: this.id,
      claudeSessionId: this.currentClaudeSessionId,
      cwd: this.cwd,
      model: this.model,
      mode: this.mode,
      lastActivity: Date.now(),
    };
    await this.stateStore.save(state);
    this.persisted = true;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class SessionRegistry {
  private readonly sessions = new Map<string, ClaudeSession>();
  private readonly connection: AgentSideConnection;
  private readonly hooks: HookServer;
  private readonly runtimeDependencies: RuntimeDependencies;
  private readonly stateStore: StateStore;

  constructor(
    connection: AgentSideConnection,
    hooks: HookServer,
    runtimeDependencies: RuntimeDependencies = {},
    stateStore = new StateStore(runtimeDependencies.stateDirectory),
  ) {
    this.connection = connection;
    this.hooks = hooks;
    this.runtimeDependencies = runtimeDependencies;
    this.stateStore = stateStore;
  }

  create(cwd: string): ClaudeSession {
    if (!path.isAbsolute(cwd)) throw new Error("ACP session cwd must be an absolute path");
    const id = randomUUID();
    return this.createSession({
      id,
      claudeSessionId: id,
      cwd: path.normalize(cwd),
      model: "default",
      mode: "default",
      persisted: false,
    });
  }

  async load(sessionId: string, cwd: string): Promise<ClaudeSession> {
    if (this.sessions.has(sessionId)) throw new Error(`ACP session ${sessionId} is already open in this adapter`);
    const state = await this.stateStore.load(sessionId);
    if (!state) throw new Error(`Persisted ACP session ${sessionId} was not found on this host`);
    assertModelId(state.model);
    assertModeId(state.mode);
    if (path.normalize(cwd) !== path.normalize(state.cwd)) throw new Error(`ACP session ${sessionId} belongs to ${state.cwd}, not ${cwd}`);
    const session = this.createSession({
      id: state.acpSessionId,
      claudeSessionId: state.claudeSessionId,
      cwd: state.cwd,
      model: state.model,
      mode: state.mode,
      persisted: true,
    });
    try {
      await session.replayHistory();
      return session;
    } catch (error) {
      this.sessions.delete(sessionId);
      await session.close();
      throw error;
    }
  }

  get(sessionId: string): ClaudeSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    await session?.close();
  }

  async clear(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.close()));
  }

  get size(): number {
    return this.sessions.size;
  }

  private createSession(options: SessionOptions): ClaudeSession {
    const session = new ClaudeSession(options, this.connection, this.hooks, this.runtimeDependencies, this.stateStore);
    this.sessions.set(session.id, session);
    return session;
  }
}
