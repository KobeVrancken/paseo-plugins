import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { escapeProjectDirName } from "../paths.server.ts";
import { TranscriptStore, readSessionSummary } from "../transcript.server.ts";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function userLine(text: string): string {
  return `${JSON.stringify({ type: "user", uuid: text, cwd: "/work/repo", message: { role: "user", content: text } })}\n`;
}

async function setupWorkspace(): Promise<{ env: Record<string, string>; file: string; workspaceDir: string }> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "claude-cfg-"));
  const workspaceDir = "/work/repo";
  const projectDir = path.join(configDir, "projects", escapeProjectDirName(workspaceDir));
  await mkdir(projectDir, { recursive: true });
  const file = path.join(projectDir, `${SESSION_ID}.jsonl`);
  await writeFile(file, userLine("first"));
  return { env: { CLAUDE_CONFIG_DIR: configDir }, file, workspaceDir };
}

test("parses only the appended tail on later polls", async () => {
  const { env, file, workspaceDir } = await setupWorkspace();
  const store = new TranscriptStore(env);

  const first = await store.timelineSince(workspaceDir, SESSION_ID, 0);
  assert.ok(first);
  assert.equal(first.total, 1);
  assert.equal(first.reset, true);

  await appendFile(file, userLine("second"));
  const second = await store.timelineSince(workspaceDir, SESSION_ID, first.revision);
  assert.ok(second);
  assert.equal(second.total, 2);
  assert.equal(second.entries.length, 1);
  assert.equal(second.reset, false);
  assert.equal(second.entries[0]!.body.kind === "user_text" && second.entries[0]!.body.text, "second");
});

test("tolerates a half-written trailing line", async () => {
  const { env, file, workspaceDir } = await setupWorkspace();
  const store = new TranscriptStore(env);
  await store.timelineSince(workspaceDir, SESSION_ID, 0);

  const partial = userLine("third");
  await appendFile(file, partial.slice(0, 20));
  const midWrite = await store.timelineSince(workspaceDir, SESSION_ID, 0);
  assert.equal(midWrite?.total, 1);

  await appendFile(file, partial.slice(20));
  const complete = await store.timelineSince(workspaceDir, SESSION_ID, 0);
  assert.equal(complete?.total, 2);
});

test("rebuilds and signals a reset when the file is rewritten", async () => {
  const { env, file, workspaceDir } = await setupWorkspace();
  const store = new TranscriptStore(env);
  const first = await store.timelineSince(workspaceDir, SESSION_ID, 0);
  assert.ok(first);

  await writeFile(file, userLine("rewritten"));
  const afterRewrite = await store.timelineSince(workspaceDir, SESSION_ID, first.revision);
  assert.ok(afterRewrite);
  assert.equal(afterRewrite.reset, true);
  assert.equal(afterRewrite.total, 1);
  assert.ok(afterRewrite.revision > first.revision);
  assert.equal(
    afterRewrite.entries[0]!.body.kind === "user_text" && afterRewrite.entries[0]!.body.text,
    "rewritten",
  );
});

test("lists sessions newest first with a preview", async () => {
  const { env, workspaceDir } = await setupWorkspace();
  const store = new TranscriptStore(env);
  const sessions = await store.listSessionFiles(workspaceDir);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.sessionId, SESSION_ID);
  assert.equal(sessions[0]!.preview, "first");
});

test("reads a summary without parsing the whole file", async () => {
  const { file } = await setupWorkspace();
  await appendFile(file, `${JSON.stringify({ type: "ai-title", aiTitle: "A title" })}\n`);
  const summary = await readSessionSummary(file);
  assert.equal(summary?.title, "A title");
  assert.equal(summary?.preview, "first");
});

test("returns null for a missing session", async () => {
  const { env, workspaceDir } = await setupWorkspace();
  const store = new TranscriptStore(env);
  assert.equal(await store.timelineSince(workspaceDir, "nope", 0), null);
});
