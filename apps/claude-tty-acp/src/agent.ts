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
import { writeLog } from "./log.ts";
import { SessionRegistry } from "./session-registry.ts";

export class ClaudeTtyAgent implements Agent {
  readonly sessions = new SessionRegistry();
  readonly connection: AgentSideConnection;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
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
    if (!this.sessions.get(params.sessionId)) throw new Error(`Session ${params.sessionId} not found`);
    throw new Error("Interactive Claude runtime is not available in this scaffold build");
  }

  async cancel(params: CancelNotification): Promise<void> {
    if (!this.sessions.get(params.sessionId)) return;
    writeLog({ level: "debug", message: "Ignored cancellation for idle scaffold session", sessionId: params.sessionId });
  }

  async close(): Promise<void> {
    this.sessions.clear();
  }
}
