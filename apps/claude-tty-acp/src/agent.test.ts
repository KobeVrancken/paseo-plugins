import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, type AgentSideConnection } from "@agentclientprotocol/sdk";
import { ClaudeTtyAgent } from "./agent.ts";

function createAgent(): ClaudeTtyAgent {
  return new ClaudeTtyAgent({ sessionUpdate: async () => undefined } as unknown as AgentSideConnection);
}

test("advertises the interactive ACP agent", async () => {
  const agent = createAgent();
  const initialized = await agent.initialize({ protocolVersion: PROTOCOL_VERSION });

  assert.equal(initialized.protocolVersion, PROTOCOL_VERSION);
  assert.equal(initialized.agentInfo?.name, "claude-tty-acp");
  assert.equal(initialized.agentCapabilities?.loadSession, true);
});

test("creates probe sessions without starting a runtime", async () => {
  const agent = createAgent();
  const created = await agent.newSession({ cwd: "/work/probe", mcpServers: [] });
  const session = agent.sessions.get(created.sessionId);

  assert.ok(session);
  assert.equal(session.cwd, "/work/probe");
  assert.equal(session.started, false);
  assert.equal(created.models?.currentModelId, "default");
  assert.deepEqual(
    created.models?.availableModels.map((model) => model.modelId),
    [
      "default",
      "opus",
      "fable",
      "sonnet",
      "haiku",
      "claude-opus-5",
      "claude-fable-5",
      "claude-opus-4-8[1m]",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-sonnet-5[1m]",
      "claude-opus-4-7[1m]",
      "claude-opus-4-7",
      "claude-opus-4-6[1m]",
      "claude-opus-4-6",
      "claude-sonnet-4-6[1m]",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
  );
  assert.equal(created.modes?.currentModeId, "default");
  await agent.close();
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
