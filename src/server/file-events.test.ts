import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { snapshotFile, snapshotsDiffer, waitForFileChange } from "./file-events.server.ts";

async function tempFile(name: string): Promise<string> {
  return path.join(await mkdtemp(path.join(os.tmpdir(), "claude-watch-")), name);
}

test("wakes on an append rather than waiting the timeout out", async () => {
  const file = await tempFile("session.jsonl");
  await writeFile(file, "{}\n");
  const before = await snapshotFile(file);
  const started = Date.now();
  const waited = waitForFileChange(file, before, 5000);
  setTimeout(() => void appendFile(file, "{}\n"), 50);
  assert.equal(await waited, true);
  assert.ok(Date.now() - started < 2000);
});

test("gives up when nothing happens", async () => {
  const file = await tempFile("session.jsonl");
  await writeFile(file, "{}\n");
  const started = Date.now();
  assert.equal(await waitForFileChange(file, await snapshotFile(file), 120), false);
  assert.ok(Date.now() - started >= 100);
});

test("waits for a transcript that does not exist yet", async () => {
  const file = await tempFile("session.jsonl");
  assert.equal(await snapshotFile(file), null);
  const waited = waitForFileChange(file, null, 5000);
  setTimeout(() => void writeFile(file, "{}\n"), 50);
  assert.equal(await waited, true);
});

test("reports a change that landed before the wait began", async () => {
  const file = await tempFile("session.jsonl");
  await writeFile(file, "{}\n");
  const before = await snapshotFile(file);
  await appendFile(file, "{}\n");
  assert.equal(await waitForFileChange(file, before, 0), true);
});

test("compares size and mtime, and counts a missing file as a state", () => {
  assert.equal(snapshotsDiffer(null, null), false);
  assert.equal(snapshotsDiffer({ size: 1, mtimeMs: 1 }, null), true);
  assert.equal(snapshotsDiffer({ size: 1, mtimeMs: 1 }, { size: 1, mtimeMs: 1 }), false);
  assert.equal(snapshotsDiffer({ size: 2, mtimeMs: 1 }, { size: 1, mtimeMs: 1 }), true);
  assert.equal(snapshotsDiffer({ size: 1, mtimeMs: 2 }, { size: 1, mtimeMs: 1 }), true);
});
