import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheDir, stateFilePath, type Env } from "./paths.server.ts";
import type { SendBehavior } from "./render-types.shared.ts";

export type { SendBehavior };

export type SessionBinding = {
  terminalId: string;
  workspaceDir: string;
  boundAt: number;
};

export type PluginState = {
  version: 1;
  settings: { sendBehavior: SendBehavior };
  bindings: Record<string, SessionBinding>;
};

function defaultState(): PluginState {
  return { version: 1, settings: { sendBehavior: "cli_default" }, bindings: {} };
}

function coerce(raw: unknown): PluginState {
  if (typeof raw !== "object" || raw === null) return defaultState();
  const record = raw as Record<string, unknown>;
  const settings = record.settings as { sendBehavior?: unknown } | undefined;
  const sendBehavior = settings?.sendBehavior;
  const bindings: Record<string, SessionBinding> = {};
  if (typeof record.bindings === "object" && record.bindings !== null) {
    for (const [sessionId, value] of Object.entries(record.bindings as Record<string, unknown>)) {
      const binding = value as Partial<SessionBinding> | null;
      if (!binding || typeof binding.terminalId !== "string") continue;
      bindings[sessionId] = {
        terminalId: binding.terminalId,
        workspaceDir: typeof binding.workspaceDir === "string" ? binding.workspaceDir : "",
        boundAt: typeof binding.boundAt === "number" ? binding.boundAt : Date.now(),
      };
    }
  }
  return {
    version: 1,
    settings: {
      sendBehavior:
        sendBehavior === "hold_until_idle" || sendBehavior === "interrupt_first"
          ? sendBehavior
          : "cli_default",
    },
    bindings,
  };
}

/** Plugin-owned persistence: the daemon config drops unknown keys, so settings and bindings live in the cache dir. */
export class StateStore {
  private state: PluginState | null = null;
  private readonly env: Env;

  constructor(env: Env = process.env) {
    this.env = env;
  }

  async load(): Promise<PluginState> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(stateFilePath(this.env), "utf8");
      this.state = coerce(JSON.parse(raw));
    } catch {
      this.state = defaultState();
    }
    return this.state;
  }

  private async persist(): Promise<void> {
    const target = stateFilePath(this.env);
    await fs.mkdir(cacheDir(this.env), { recursive: true });
    const temporary = path.join(path.dirname(target), `.state-${process.pid}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2));
    await fs.rename(temporary, target);
  }

  async settings(): Promise<PluginState["settings"]> {
    return (await this.load()).settings;
  }

  async setSendBehavior(sendBehavior: SendBehavior): Promise<void> {
    const state = await this.load();
    state.settings.sendBehavior = sendBehavior;
    await this.persist();
  }

  async binding(sessionId: string): Promise<SessionBinding | null> {
    return (await this.load()).bindings[sessionId] ?? null;
  }

  async bindings(): Promise<Record<string, SessionBinding>> {
    return (await this.load()).bindings;
  }

  async bind(sessionId: string, binding: SessionBinding): Promise<void> {
    const state = await this.load();
    state.bindings[sessionId] = binding;
    await this.persist();
  }

  async unbind(sessionId: string): Promise<void> {
    const state = await this.load();
    if (!(sessionId in state.bindings)) return;
    delete state.bindings[sessionId];
    await this.persist();
  }

  /** Bindings outlive the terminals they point at, so dead ones are dropped as soon as they are noticed. */
  async pruneBindings(liveTerminalIds: Set<string>): Promise<string[]> {
    const state = await this.load();
    const dropped: string[] = [];
    for (const [sessionId, binding] of Object.entries(state.bindings)) {
      if (liveTerminalIds.has(binding.terminalId)) continue;
      dropped.push(sessionId);
      delete state.bindings[sessionId];
    }
    if (dropped.length > 0) await this.persist();
    return dropped;
  }
}
