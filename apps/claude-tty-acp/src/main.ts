import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { ClaudeTtyAgent } from "./agent.ts";
import { idleTimeoutFromEnv } from "./idle-timeout.ts";
import { writeLog } from "./log.ts";
import { cleanupAbandonedRuntimeDirectories } from "./runtime-directories.ts";

export async function runAcpServer(): Promise<void> {
  await cleanupAbandonedRuntimeDirectories();
  const idleTimeoutMs = idleTimeoutFromEnv();
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  let agent: ClaudeTtyAgent | null = null;
  const connection = new AgentSideConnection((activeConnection) => {
    agent = new ClaudeTtyAgent(activeConnection, { idleTimeoutMs });
    return agent;
  }, ndJsonStream(output, input));

  const shutdown = async (signal: string): Promise<void> => {
    writeLog({ level: "info", message: "Stopping ACP adapter", signal });
    await agent?.close();
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).finally(() => process.exit(0));
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  await connection.closed;
  process.off("SIGINT", handleSignal);
  process.off("SIGTERM", handleSignal);
  await shutdown("connection_closed");
}
