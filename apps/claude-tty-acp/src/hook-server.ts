import { randomBytes } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { writeLog } from "./log.ts";

const MAX_HOOK_BODY_BYTES = 1024 * 1024;

export type HookPayload = {
  hook_event_name?: string;
  session_id?: string;
  last_assistant_message?: string;
  error?: string;
  [key: string]: unknown;
};

export type HookResponse = Record<string, unknown>;
export type HookHandler = (payload: HookPayload) => Promise<HookResponse>;

export class HookServer {
  private readonly handlers = new Map<string, HookHandler>();
  private readonly token = randomBytes(32).toString("hex");
  private server: http.Server | null = null;
  private endpoint: string | null = null;
  private startPromise: Promise<string> | null = null;

  async start(): Promise<string> {
    if (this.endpoint) return this.endpoint;
    this.startPromise ??= this.startListening();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startListening(): Promise<string> {
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const server = this.server;
        if (!server) return reject(new Error("Hook server was not created"));
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      this.server = null;
      throw error;
    }
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Hook server did not bind a TCP port");
    this.endpoint = `http://127.0.0.1:${address.port}/hooks/${this.token}`;
    writeLog({ level: "debug", message: "Started loopback hook server", port: address.port });
    return this.endpoint;
  }

  register(sessionId: string, handler: HookHandler): () => void {
    if (this.handlers.has(sessionId)) throw new Error(`Hook handler already registered for Claude session ${sessionId}`);
    this.handlers.set(sessionId, handler);
    return () => {
      if (this.handlers.get(sessionId) === handler) this.handlers.delete(sessionId);
    };
  }

  async dispatch(payload: HookPayload): Promise<HookResponse> {
    const sessionId = payload.session_id;
    if (!sessionId) throw new HookRequestError(400, "Hook payload is missing session_id");
    const handler = this.handlers.get(sessionId);
    if (!handler) throw new HookRequestError(404, `No active adapter session for Claude session ${sessionId}`);
    return handler(payload);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    const server = this.server;
    this.server = null;
    this.endpoint = null;
    if (!server) return;
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== `/hooks/${this.token}`) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, await this.dispatch(body));
    } catch (error) {
      const status = error instanceof HookRequestError ? error.status : 500;
      writeLog({ level: status >= 500 ? "error" : "warn", message: "Rejected Claude hook request", error: errorMessage(error) });
      sendJson(response, status, { error: errorMessage(error) });
    }
  }
}

class HookRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<HookPayload> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_HOOK_BODY_BYTES) throw new HookRequestError(413, "Hook payload is too large");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HookRequestError(400, "Hook payload is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HookRequestError(400, "Hook payload must be an object");
  return parsed as HookPayload;
}

function sendJson(response: ServerResponse, status: number, body: HookResponse): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
