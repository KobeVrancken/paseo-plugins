import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSideConnection, SessionNotification } from "@agentclientprotocol/sdk";
import { TranscriptTranslator } from "./transcript-translator.ts";

test("translates messages, reasoning, tools, plans, usage, images, and system activity", async () => {
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);
  const records = [
    {
      type: "user",
      uuid: "user-1",
      message: { content: "hello<system-reminder>hidden</system-reminder>" },
    },
    {
      type: "assistant",
      uuid: "assistant-1",
      requestId: "request-1",
      context_window: 200_000,
      message: {
        usage: { input_tokens: 100, cache_read_input_tokens: 50 },
        content: [
          { type: "thinking", thinking: "considering" },
          { type: "text", text: "working" },
          { type: "tool_use", id: "edit-1", name: "Edit", input: { file_path: "src/app.ts", old_string: "a", new_string: "b" } },
          {
            type: "tool_use",
            id: "todo-1",
            name: "TodoWrite",
            input: { todos: [{ content: "Implement", status: "in_progress" }, { content: "Verify", status: "pending" }] },
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "result-1",
      message: { content: [{ type: "tool_result", tool_use_id: "edit-1", content: [{ type: "text", text: "updated" }] }] },
    },
    {
      type: "assistant",
      uuid: "assistant-image",
      message: { content: [{ type: "image", source: { data: "aW1hZ2U=", media_type: "image/png" } }] },
    },
    { type: "system", uuid: "system-1", subtype: "api_error", content: "Transient API error" },
  ];

  await translator.translate(records);
  await translator.translate(records);

  assert.deepEqual(
    notifications.map((notification) => notification.update.sessionUpdate),
    ["user_message_chunk", "agent_thought_chunk", "agent_message_chunk", "tool_call", "plan", "usage_update", "tool_call_update", "agent_message_chunk", "agent_message_chunk"],
  );
  const tool = notifications.find((notification) => notification.update.sessionUpdate === "tool_call")?.update;
  assert.ok(tool?.sessionUpdate === "tool_call");
  assert.equal(tool.kind, "edit");
  assert.deepEqual(tool.locations, [{ path: "/work/repo/src/app.ts" }]);
  assert.deepEqual(tool.content, [{ type: "diff", path: "/work/repo/src/app.ts", oldText: "a", newText: "b" }]);
  const plan = notifications.find((notification) => notification.update.sessionUpdate === "plan")?.update;
  assert.ok(plan?.sessionUpdate === "plan");
  assert.deepEqual(plan.entries.map((entry) => entry.status), ["in_progress", "pending"]);
  const usage = notifications.find((notification) => notification.update.sessionUpdate === "usage_update")?.update;
  assert.deepEqual(usage, { sessionUpdate: "usage_update", size: 200_000, used: 150 });
  const chunks = notifications.filter((notification) => notification.update.sessionUpdate.endsWith("message_chunk"));
  assert.ok(chunks.every((notification) => "messageId" in notification.update && /^[0-9a-f-]{36}$/.test(String(notification.update.messageId))));
  assert.equal(translator.assistantChunks, 3);
});

test("suppresses a transcript answer already emitted from the Stop fallback", async () => {
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);

  translator.suppressNextAssistantText("Hello from Claude");
  await translator.translate([
    { type: "assistant", uuid: "late-answer", message: { content: [{ type: "text", text: "Hello from Claude" }] } },
  ]);
  assert.equal(notifications.length, 0);

  await translator.translate([{ type: "user", uuid: "next-user", message: { content: "next" } }]);
  await translator.translate([
    { type: "assistant", uuid: "next-answer", message: { content: [{ type: "text", text: "Hello from Claude" }] } },
  ]);
  assert.deepEqual(notifications.map((notification) => notification.update.sessionUpdate), ["user_message_chunk", "agent_message_chunk"]);
});

test("renders question tool calls as readable text instead of raw JSON", async () => {
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);
  const input = {
    questions: [
      {
        question: "Choose runtime",
        header: "Runtime",
        options: [
          { label: "Node", description: "Use the established runtime" },
          { label: "Bun", description: "Use the faster alternative" },
        ],
        multiSelect: false,
      },
    ],
  };

  await translator.translate([
    {
      type: "assistant",
      uuid: "question-message",
      message: { content: [{ type: "tool_use", id: "question-tool", name: "AskUserQuestion", input }] },
    },
  ]);

  assert.equal(notifications.length, 1);
  const update = notifications[0]?.update;
  assert.ok(update?.sessionUpdate === "tool_call");
  assert.deepEqual(update.rawInput, input);
  assert.deepEqual(update.content, [
    {
      type: "content",
      content: {
        type: "text",
        text: "Choose runtime\n\n- Node — Use the established runtime\n- Bun — Use the faster alternative",
      },
    },
  ]);
});

test("keeps an asynchronous agent's tool call open and streams the work it does", async () => {
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);

  await translator.translate([
    {
      type: "assistant",
      uuid: "launcher",
      message: {
        content: [{ type: "tool_use", id: "agent-tool", name: "Agent", input: { description: "Audit the API", subagent_type: "general-purpose" } }],
      },
    },
    {
      type: "user",
      uuid: "launched",
      toolUseResult: { isAsync: true, status: "async_launched", agentId: "a1", description: "Audit the API" },
      message: { content: [{ type: "tool_result", tool_use_id: "agent-tool", content: [{ type: "text", text: "Async agent launched successfully." }] }] },
    },
  ]);

  const launch = notifications.map((notification) => notification.update);
  assert.deepEqual(launch.map((update) => update.sessionUpdate), ["tool_call", "tool_call_update"]);
  assert.ok(launch[0]?.sessionUpdate === "tool_call");
  assert.equal(launch[0].title, "Agent: Audit the API");
  assert.equal(launch[0].status, "in_progress");
  assert.ok(launch[1]?.sessionUpdate === "tool_call_update");
  assert.equal(launch[1].status, "in_progress");

  notifications.length = 0;
  await translator.translateSubagent("a1", [
    {
      type: "assistant",
      uuid: "sub-1",
      message: {
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "Reading the controllers" },
          { type: "tool_use", id: "sub-read", name: "Read", input: { file_path: "src/app.ts" } },
        ],
      },
    },
  ]);

  assert.equal(notifications.length, 1);
  const streamed = notifications[0]?.update;
  assert.ok(streamed?.sessionUpdate === "tool_call_update");
  assert.equal(streamed.toolCallId, "agent-tool");
  assert.equal(streamed.status, "in_progress");
  assert.deepEqual(streamed.content, [
    { type: "content", content: { type: "text", text: "Reading the controllers\n• Read: src/app.ts" } },
  ]);

  notifications.length = 0;
  const notification =
    "<task-notification> <task-id>a1</task-id> <tool-use-id>agent-tool</tool-use-id> <status>completed</status> <summary>Agent \"Audit the API\" finished</summary> </task-notification>";
  await translator.translate([{ type: "user", uuid: "notified", message: { content: notification } }]);
  await translator.translate([{ type: "user", uuid: "notified", message: { content: notification } }]);

  assert.equal(notifications.length, 1);
  const finished = notifications[0]?.update;
  assert.ok(finished?.sessionUpdate === "tool_call_update");
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.content, [
    {
      type: "content",
      content: { type: "text", text: 'Reading the controllers\n• Read: src/app.ts\nAgent "Audit the API" finished' },
    },
  ]);
});

test("shows a subagent's steps that arrived before its launch was read, and its nested agents", async () => {
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);

  await translator.translateSubagent("a1", [
    { type: "assistant", uuid: "early", message: { content: [{ type: "text", text: "Started early" }] } },
  ]);
  assert.equal(notifications.length, 0);

  await translator.translate([
    {
      type: "assistant",
      uuid: "launcher",
      message: { content: [{ type: "tool_use", id: "agent-tool", name: "Task", input: { description: "Search" } }] },
    },
    {
      type: "user",
      uuid: "finished",
      toolUseResult: { status: "completed", agentId: "a1" },
      message: { content: [{ type: "tool_result", tool_use_id: "agent-tool", content: [{ type: "text", text: "report" }] }] },
    },
  ]);

  // A synchronous agent answers when it is done, so its card is linked, filled in and then closed.
  assert.deepEqual(notifications.map((notification) => notification.update.sessionUpdate), ["tool_call", "tool_call_update", "tool_call_update"]);
  const linked = notifications[1]?.update;
  assert.ok(linked?.sessionUpdate === "tool_call_update");
  assert.deepEqual(linked.content, [{ type: "content", content: { type: "text", text: "Started early" } }]);
  const closed = notifications[2]?.update;
  assert.ok(closed?.sessionUpdate === "tool_call_update");
  assert.equal(closed.status, "completed");

  notifications.length = 0;
  await translator.translateSubagent("a1", [
    { type: "user", uuid: "nested-launch", toolUseResult: { isAsync: true, status: "async_launched", agentId: "a2" }, message: { content: [] } },
  ]);
  await translator.translateSubagent("a2", [
    { type: "assistant", uuid: "nested", message: { content: [{ type: "text", text: "Nested work" }] } },
  ]);

  assert.equal(notifications.length, 1);
  const nested = notifications[0]?.update;
  assert.ok(nested?.sessionUpdate === "tool_call_update");
  assert.equal(nested.toolCallId, "agent-tool");
  assert.deepEqual(nested.content, [{ type: "content", content: { type: "text", text: "Started early\n↳ Nested work" } }]);
});

test("carries a nested subagent's earlier steps onto the card of the agent that launched it", async () => {
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);

  // Transcripts are read in name order, so a nested agent is routinely seen before its spawner.
  await translator.translateSubagent("nested", [
    { type: "assistant", uuid: "n1", message: { content: [{ type: "text", text: "Nested first step" }] } },
  ]);
  await translator.translateSubagent("spawner", [
    { type: "user", uuid: "s1", toolUseResult: { isAsync: true, status: "async_launched", agentId: "nested" }, message: { content: [] } },
    { type: "assistant", uuid: "s2", message: { content: [{ type: "text", text: "Spawner step" }] } },
  ]);
  await translator.translate([
    {
      type: "assistant",
      uuid: "launcher",
      message: { content: [{ type: "tool_use", id: "agent-tool", name: "Agent", input: { description: "Investigate" } }] },
    },
    {
      type: "user",
      uuid: "launched",
      toolUseResult: { isAsync: true, status: "async_launched", agentId: "spawner" },
      message: { content: [{ type: "tool_result", tool_use_id: "agent-tool", content: [] }] },
    },
  ]);

  const linked = notifications.at(-1)?.update;
  assert.ok(linked?.sessionUpdate === "tool_call_update");
  assert.deepEqual(linked.content, [
    { type: "content", content: { type: "text", text: "↳ Nested first step\nSpawner step" } },
  ]);

  notifications.length = 0;
  await translator.translateSubagent("nested", [
    { type: "assistant", uuid: "n2", message: { content: [{ type: "text", text: "Nested later step" }] } },
  ]);
  const streamed = notifications[0]?.update;
  assert.ok(streamed?.sessionUpdate === "tool_call_update");
  assert.equal(streamed.toolCallId, "agent-tool");
  assert.deepEqual(streamed.content, [
    { type: "content", content: { type: "text", text: "↳ Nested first step\nSpawner step\n↳ Nested later step" } },
  ]);
});

test("counts the agents a turn is still waiting on, and ignores the ones history only remembers", async () => {
  const connection = { sessionUpdate: async () => undefined } as unknown as AgentSideConnection;
  const translator = new TranscriptTranslator("session", "/work/repo", connection);
  const launch = (toolCallId: string, agentId: string, running: boolean) => [
    {
      type: "assistant",
      uuid: `launcher-${agentId}`,
      message: { content: [{ type: "tool_use", id: toolCallId, name: "Agent", input: { description: agentId } }] },
    },
    {
      type: "user",
      uuid: `launched-${agentId}`,
      toolUseResult: running ? { isAsync: true, status: "async_launched", agentId } : { status: "completed", agentId },
      message: { content: [{ type: "tool_result", tool_use_id: toolCallId, content: [] }] },
    },
  ];

  // A session being loaded replays a transcript whose agents died with the process that ran them.
  await translator.translate(launch("history-tool", "history", true));
  assert.equal(translator.runningSubagents, 0);

  translator.trackRunningSubagents();
  await translator.translate([...launch("async-tool", "async", true), ...launch("sync-tool", "sync", false)]);
  assert.equal(translator.runningSubagents, 1);

  // A nested agent is part of the one piece of work the session launched, not a second one.
  await translator.translateSubagent("async", [
    { type: "user", uuid: "nested", toolUseResult: { isAsync: true, status: "async_launched", agentId: "nested" }, message: { content: [] } },
  ]);
  assert.equal(translator.runningSubagents, 1);

  const activityBefore = translator.subagentActivityAt;
  assert.ok(activityBefore > 0);
  await translator.translate([
    {
      type: "user",
      uuid: "notified",
      message: { content: "<task-notification> <task-id>async</task-id> <status>completed</status> <summary>done</summary> </task-notification>" },
    },
  ]);
  assert.equal(translator.runningSubagents, 0);
  assert.ok(translator.subagentActivityAt >= activityBefore);
});
