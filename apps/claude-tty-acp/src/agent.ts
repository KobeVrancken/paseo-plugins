import {
  PROTOCOL_VERSION,
  type Agent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk";
import { APP_NAME, APP_TITLE, APP_VERSION } from "./constants.ts";
import { HookServer } from "./hook-server.ts";
import { writeLog } from "./log.ts";
import { SessionRegistry } from "./session-registry.ts";
import type { RuntimeDependencies } from "./claude-runtime.ts";

export class ClaudeTtyAgent implements Agent {
  readonly hooks = new HookServer();
  readonly sessions: SessionRegistry;
  readonly connection: AgentSideConnection;

  constructor(connection: AgentSideConnection, runtimeDependencies: RuntimeDependencies = {}) {
    this.connection = connection;
    this.sessions = new SessionRegistry(connection, this.hooks, runtimeDependencies);
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          embeddedContext: false,
          image: false,
          audio: false,
        },
      },
      agentInfo: {
        name: APP_NAME,
        title: APP_TITLE,
        version: APP_VERSION,
      },
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    if (params.mcpServers.length > 0) {
      throw new Error(`${APP_TITLE} does not accept ACP-injected MCP servers`);
    }
    const session = this.sessions.create(params.cwd);
    writeLog({ level: "info", message: "Created lazy ACP session", sessionId: session.id, cwd: session.cwd });
    return { sessionId: session.id };
  }

  async authenticate(_params: AuthenticateRequest): Promise<Record<string, never>> {
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);
    return session.prompt(params.prompt);
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.cancel();
  }

  async close(): Promise<void> {
    await this.sessions.clear();
    await this.hooks.close();
  }
}
