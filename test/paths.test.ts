import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claudeProjectsDir, escapeProjectDirName, resolveProjectDir } from "../src/server/paths.server.ts";

test("escapes every non-alphanumeric character in a workspace path", () => {
  assert.equal(
    escapeProjectDirName("/home/user/Projects/misc/example.com"),
    "-home-user-Projects-misc-example-com",
  );
  assert.equal(escapeProjectDirName("/tmp/my_project"), "-tmp-my-project");
});

test("honours CLAUDE_CONFIG_DIR", () => {
  assert.equal(claudeProjectsDir({ CLAUDE_CONFIG_DIR: "/cfg" }), path.join("/cfg", "projects"));
  assert.equal(claudeProjectsDir({ HOME: "/home/x" }), path.join("/home/x", ".claude", "projects"));
});

test("resolves the project directory by name", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "claude-cfg-"));
  const workspaceDir = "/work/some.repo";
  const projectDir = path.join(configDir, "projects", escapeProjectDirName(workspaceDir));
  await mkdir(projectDir, { recursive: true });
  assert.equal(await resolveProjectDir(workspaceDir, { CLAUDE_CONFIG_DIR: configDir }), projectDir);
});

test("falls back to the cwd recorded inside a transcript", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "claude-cfg-"));
  const projectDir = path.join(configDir, "projects", "surprising-name");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, "abc.jsonl"),
    `${JSON.stringify({ type: "user", cwd: "/work/other", message: { role: "user", content: "hi" } })}\n`,
  );
  assert.equal(await resolveProjectDir("/work/other", { CLAUDE_CONFIG_DIR: configDir }), projectDir);
});

test("returns null when no transcripts exist", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "claude-cfg-"));
  assert.equal(await resolveProjectDir("/work/nothing", { CLAUDE_CONFIG_DIR: configDir }), null);
});
