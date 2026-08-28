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
