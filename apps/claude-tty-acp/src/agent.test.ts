import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, type AgentSideConnection } from "@agentclientprotocol/sdk";
import { ClaudeTtyAgent } from "./agent.ts";

function createAgent(): ClaudeTtyAgent {
  return new ClaudeTtyAgent({} as AgentSideConnection);
}

test("advertises a lazy ACP scaffold", async () => {
  const agent = createAgent();
  const initialized = await agent.initialize({ protocolVersion: PROTOCOL_VERSION });

  assert.equal(initialized.protocolVersion, PROTOCOL_VERSION);
  assert.equal(initialized.agentInfo?.name, "claude-tty-acp");
  assert.equal(initialized.agentCapabilities?.loadSession, false);
});

test("creates probe sessions without starting a runtime", async () => {
  const agent = createAgent();
  const created = await agent.newSession({ cwd: "/work/probe", mcpServers: [] });
  const session = agent.sessions.get(created.sessionId);

  assert.ok(session);
  assert.equal(session.cwd, "/work/probe");
  assert.equal(session.started, false);
});

test("rejects injected MCP servers", async () => {
  const agent = createAgent();
  await assert.rejects(
    agent.newSession({
      cwd: "/work/probe",
      mcpServers: [{ name: "example", command: "example", args: [], env: [] }],
    }),
    /does not accept ACP-injected MCP servers/,
  );
});
