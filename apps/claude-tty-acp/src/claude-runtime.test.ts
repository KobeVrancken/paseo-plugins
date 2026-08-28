import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentSideConnection, SessionNotification } from "@agentclientprotocol/sdk";
import type { IPty, IPtyForkOptions } from "node-pty";
import { ClaudeTtyAgent } from "./agent.ts";

class FakePty {
  readonly pid: number;
  readonly writes: string[] = [];
  killed = false;
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  constructor(pid: number) {
    this.pid = pid;
  }

  write(data: string | Buffer): void {
    this.writes.push(data.toString());
  }

  kill(): void {
    this.killed = true;
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    this.dataHandlers.push(handler);
    return { dispose: () => undefined };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitHandlers.push(handler);
    return { dispose: () => undefined };
  }
}

type SpawnRecord = {
  file: string;
  args: string[];
  options: IPtyForkOptions;
  pty: FakePty;
};

function createConnection(updates: SessionNotification[]): AgentSideConnection {
  return {
    sessionUpdate: async (update: SessionNotification) => {
      updates.push(update);
    },
  } as AgentSideConnection;
}

test("starts isolated interactive PTYs and completes parallel turns through hooks", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runtime-test-"));
  const spawns: SpawnRecord[] = [];
  const updates: SessionNotification[] = [];
  let agent!: ClaudeTtyAgent;
  const spawnPty = (file: string, args: string[], options: IPtyForkOptions): Pick<IPty, "pid" | "write" | "kill" | "onData" | "onExit"> => {
    const pty = new FakePty(1000 + spawns.length);
    spawns.push({ file, args, options, pty });
    const sessionId = args[args.indexOf("--session-id") + 1];
    setImmediate(() => void agent.hooks.dispatch({ hook_event_name: "SessionStart", session_id: sessionId }));
    return pty;
  };
  agent = new ClaudeTtyAgent(createConnection(updates), { spawnPty, runtimeRoot, stateDirectory: path.join(runtimeRoot, "state"), startupTimeoutMs: 500 });

  try {
    const first = await agent.newSession({ cwd: "/work/one", mcpServers: [] });
    const second = await agent.newSession({ cwd: "/work/two", mcpServers: [] });
    const firstTurn = agent.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "first $(safe)" }] });
    const secondTurn = agent.prompt({ sessionId: second.sessionId, prompt: [{ type: "text", text: "second" }] });
    await waitFor(() => spawns.length === 2 && spawns.every((spawn) => spawn.pty.writes.length === 1));

    const firstSpawn = spawns.find((spawn) => spawn.args[1] === first.sessionId);
    const secondSpawn = spawns.find((spawn) => spawn.args[1] === second.sessionId);
    assert.equal(firstSpawn?.file, "claude");
    assert.deepEqual(firstSpawn?.args.slice(0, 2), ["--session-id", first.sessionId]);
    assert.equal(firstSpawn?.options.cwd, "/work/one");
    assert.equal(secondSpawn?.options.cwd, "/work/two");
    assert.equal(firstSpawn?.pty.writes[0], "\u001b[200~first $(safe)\u001b[201~\r");
    assert.equal(secondSpawn?.pty.writes[0], "\u001b[200~second\u001b[201~\r");

    await Promise.all([
      agent.hooks.dispatch({ hook_event_name: "Stop", session_id: first.sessionId, last_assistant_message: "one done" }),
      agent.hooks.dispatch({ hook_event_name: "Stop", session_id: second.sessionId, last_assistant_message: "two done" }),
    ]);
    assert.deepEqual(await Promise.all([firstTurn, secondTurn]), [{ stopReason: "end_turn" }, { stopReason: "end_turn" }]);
    assert.deepEqual(
      updates.map((notification) => notification.update.sessionUpdate),
      ["agent_message_chunk", "agent_message_chunk"],
    );
  } finally {
    await agent.close();
    assert.ok(spawns.every((spawn) => spawn.pty.killed));
    assert.equal((await readdir(runtimeRoot)).some((name) => name.startsWith("claude-tty-acp-")), false);
    await rm(runtimeRoot, { force: true, recursive: true });
  }
});

test("cancels an active turn with Escape", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runtime-test-"));
  let agent!: ClaudeTtyAgent;
  let spawned: FakePty | null = null;
  const spawnPty = (_file: string, args: string[]): Pick<IPty, "pid" | "write" | "kill" | "onData" | "onExit"> => {
    spawned = new FakePty(2000);
    const sessionId = args[args.indexOf("--session-id") + 1];
    setImmediate(() => void agent.hooks.dispatch({ hook_event_name: "SessionStart", session_id: sessionId }));
    return spawned;
  };
  agent = new ClaudeTtyAgent(createConnection([]), { spawnPty, runtimeRoot, stateDirectory: path.join(runtimeRoot, "state"), startupTimeoutMs: 500, cancelTimeoutMs: 5 });

  try {
    const session = await agent.newSession({ cwd: "/work/cancel", mcpServers: [] });
    const turn = agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "cancel me" }] });
    await waitFor(() => spawned !== null && spawned.writes.length === 1);
    await agent.cancel({ sessionId: session.sessionId });
    assert.deepEqual(await turn, { stopReason: "cancelled" });
    assert.equal((spawned as FakePty | null)?.writes.at(-1), "\u001b");
  } finally {
    await agent.close();
    await rm(runtimeRoot, { force: true, recursive: true });
  }
});

test("fails closed when Claude never completes the startup hook", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runtime-test-"));
  const pty = new FakePty(3000);
  const agent = new ClaudeTtyAgent(createConnection([]), {
    spawnPty: () => pty,
    runtimeRoot,
    stateDirectory: path.join(runtimeRoot, "state"),
    startupTimeoutMs: 5,
  });

  try {
    const session = await agent.newSession({ cwd: "/work/blocked", mcpServers: [] });
    await assert.rejects(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hello" }] }),
      /SessionStart hook handshake/,
    );
    assert.equal(pty.killed, true);
    assert.equal((await readdir(runtimeRoot)).some((name) => name.startsWith("claude-tty-acp-")), false);
  } finally {
    await agent.close();
    await rm(runtimeRoot, { force: true, recursive: true });
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
