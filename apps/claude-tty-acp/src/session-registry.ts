import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentSideConnection, ContentBlock, PromptResponse } from "@agentclientprotocol/sdk";
import { ClaudeRuntime, type RuntimeDependencies } from "./claude-runtime.ts";
import { HookServer } from "./hook-server.ts";

export class ClaudeSession {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  readonly cwd: string;
  private readonly connection: AgentSideConnection;
  private readonly hooks: HookServer;
  private readonly runtimeDependencies: RuntimeDependencies;
  private runtime: ClaudeRuntime | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    cwd: string,
    connection: AgentSideConnection,
    hooks: HookServer,
    runtimeDependencies: RuntimeDependencies,
  ) {
    this.cwd = cwd;
    this.connection = connection;
    this.hooks = hooks;
    this.runtimeDependencies = runtimeDependencies;
  }

  get started(): boolean {
    return this.runtime?.started ?? false;
  }

  prompt(content: ContentBlock[]): Promise<PromptResponse> {
    return this.exclusive(async () => {
      this.runtime ??= new ClaudeRuntime(this.id, this.cwd, this.connection, this.hooks, this.runtimeDependencies);
      return this.runtime.prompt(content);
    });
  }

  cancel(): void {
    this.runtime?.cancel();
  }

  async close(): Promise<void> {
    await this.runtime?.close();
    this.runtime = null;
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

  constructor(
    connection: AgentSideConnection,
    hooks: HookServer,
    runtimeDependencies: RuntimeDependencies = {},
  ) {
    this.connection = connection;
    this.hooks = hooks;
    this.runtimeDependencies = runtimeDependencies;
  }

  create(cwd: string): ClaudeSession {
    if (!path.isAbsolute(cwd)) throw new Error("ACP session cwd must be an absolute path");
    const session = new ClaudeSession(path.normalize(cwd), this.connection, this.hooks, this.runtimeDependencies);
    this.sessions.set(session.id, session);
    return session;
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
}
