import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SubagentWatcher } from "./subagent-watcher.ts";
import type { TranscriptRecord } from "./transcript-reader.ts";

function record(text: string): string {
  return `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`;
}

test("follows every subagent transcript from where it last read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "subagents-"));
  const transcript = path.join(root, "session.jsonl");
  const directory = path.join(root, "session", "subagents");
  const seen: Array<{ agentId: string; records: TranscriptRecord[] }> = [];
  const watcher = new SubagentWatcher(transcript, { translateSubagent: async (agentId, records) => void seen.push({ agentId, records }) }, root, 0);

  // A session that has never run a subagent has no directory of them.
  await watcher.sync();
  assert.equal(seen.length, 0);

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "agent-a1.jsonl"), record("first"));
  await writeFile(path.join(directory, "notes.txt"), "ignored");
  await watcher.sync();
  assert.deepEqual(seen.map((entry) => entry.agentId), ["a1"]);
  assert.equal(seen[0]?.records.length, 1);

  await watcher.sync();
  assert.equal(seen.length, 1);

  await writeFile(path.join(directory, "agent-a1.jsonl"), `${record("first")}${record("second")}`);
  await writeFile(path.join(directory, "agent-a2.jsonl"), record("other"));
  await watcher.sync();
  assert.deepEqual(seen.slice(1).map((entry) => entry.agentId), ["a1", "a2"]);
  assert.equal(seen[1]?.records.length, 1);

  watcher.close();
  await writeFile(path.join(directory, "agent-a3.jsonl"), record("after close"));
  await watcher.sync();
  assert.equal(seen.length, 3);
});

test("reads no more often than its interval unless the end of a turn forces it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "subagents-"));
  const directory = path.join(root, "session", "subagents");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "agent-a1.jsonl"), record("first"));
  const seen: string[] = [];
  const watcher = new SubagentWatcher(
    path.join(root, "session.jsonl"),
    { translateSubagent: async (agentId) => void seen.push(agentId) },
    root,
    60_000,
  );

  await watcher.sync();
  await writeFile(path.join(directory, "agent-a1.jsonl"), `${record("first")}${record("second")}`);
  await watcher.sync();
  assert.deepEqual(seen, ["a1"]);

  await watcher.sync(true);
  assert.deepEqual(seen, ["a1", "a1"]);
});
