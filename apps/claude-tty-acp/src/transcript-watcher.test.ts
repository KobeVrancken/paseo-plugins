import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentSideConnection, SessionNotification } from "@agentclientprotocol/sdk";
import { escapeProjectDirName, TranscriptReader } from "./transcript-reader.ts";
import { TranscriptTranslator } from "./transcript-translator.ts";
import { TranscriptWatcher } from "./transcript-watcher.ts";

test("streams a delayed transcript and flushes its final offset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "transcript-watcher-test-"));
  const cwd = "/work/watch";
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const notifications: SessionNotification[] = [];
  const connection = {
    sessionUpdate: async (notification: SessionNotification) => {
      notifications.push(notification);
    },
  } as AgentSideConnection;
  const watcher = new TranscriptWatcher(
    new TranscriptReader(sessionId, cwd, { configDir: root }),
    new TranscriptTranslator(sessionId, cwd, connection),
    5,
  );

  try {
    await watcher.start();
    const projectDir = path.join(root, "projects", escapeProjectDirName(cwd));
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);
    await mkdir(projectDir, { recursive: true });
    const user = `${JSON.stringify({ type: "user", uuid: "user", message: { content: "hello" } })}\n`;
    await writeFile(filePath, user);
    await waitFor(() => notifications.length === 1);

    const assistant = `${JSON.stringify({ type: "assistant", uuid: "assistant", message: { content: [{ type: "text", text: "done" }] } })}\n`;
    await appendFile(filePath, assistant.slice(0, 25));
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(notifications.length, 1);
    await appendFile(filePath, assistant.slice(25));
    await watcher.flushUntilStable();
    assert.deepEqual(notifications.map((notification) => notification.update.sessionUpdate), ["user_message_chunk", "agent_message_chunk"]);
  } finally {
    await watcher.close();
    await rm(root, { force: true, recursive: true });
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for transcript update");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
