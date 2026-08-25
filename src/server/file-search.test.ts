import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { searchWorkspaceEntries, splitQuery } from "./file-search.server.ts";

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-files-"));
  for (const directory of [
    "src/client",
    "src/server",
    "node_modules/react",
    ".claude/skills/deploy",
    ".cache",
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  for (const file of [
    "README.md",
    "src/client/panel.tsx",
    "src/server/panel.ts",
    "src/server/paths.ts",
    "node_modules/react/index.js",
    ".claude/skills/deploy/SKILL.md",
    ".cache/state.json",
  ]) {
    await writeFile(path.join(root, file), "");
  }
  await symlink(path.join(root, "src/server"), path.join(root, "linked-server"), "dir");
  return root;
}

function paths(entries: { path: string }[]): string[] {
  return entries.map((entry) => entry.path);
}

test("splits a path query from a bare term", () => {
  assert.deepEqual(splitQuery("src/comp"), { directory: "src", term: "comp" });
  assert.deepEqual(splitQuery("src/"), { directory: "src", term: "" });
  assert.deepEqual(splitQuery("./src/a/b"), { directory: "src/a", term: "b" });
  assert.deepEqual(splitQuery("  panel "), { directory: "", term: "panel" });
  assert.deepEqual(splitQuery(""), { directory: "", term: "" });
});

test("lists the root on a blank query, without the noise directories", () => {
  return workspace().then(async (root) => {
    const entries = paths(await searchWorkspaceEntries({ root, query: "" }));
    assert.ok(entries.includes("README.md"));
    assert.ok(entries.includes("src"));
    assert.ok(entries.includes(".claude"));
    assert.ok(!entries.includes("node_modules"));
    assert.ok(!entries.includes(".cache"));
  });
});

test("browses the directory a path query names", async () => {
  const root = await workspace();
  assert.deepEqual(paths(await searchWorkspaceEntries({ root, query: "src/" })).sort(), [
    "src/client",
    "src/server",
  ]);
  assert.deepEqual(paths(await searchWorkspaceEntries({ root, query: "src/server/pa" })).sort(), [
    "src/server/panel.ts",
    "src/server/paths.ts",
  ]);
  assert.deepEqual(await searchWorkspaceEntries({ root, query: "../etc/" }), []);
});

test("searches the whole tree for a bare term, shallowest first", async () => {
  const root = await workspace();
  const entries = paths(await searchWorkspaceEntries({ root, query: "panel" }));
  assert.deepEqual(entries, ["src/client/panel.tsx", "src/server/panel.ts"]);
  assert.deepEqual(paths(await searchWorkspaceEntries({ root, query: "react" })), []);
});

test("browses a symlinked directory and reaches an allowed dot directory", async () => {
  const root = await workspace();
  assert.deepEqual(paths(await searchWorkspaceEntries({ root, query: "linked-server/" })).sort(), [
    "linked-server/panel.ts",
    "linked-server/paths.ts",
  ]);
  assert.ok(
    paths(await searchWorkspaceEntries({ root, query: "SKILL" })).includes(
      ".claude/skills/deploy/SKILL.md",
    ),
  );
});

test("keeps files or directories out when asked to", async () => {
  const root = await workspace();
  const directories = await searchWorkspaceEntries({ root, query: "", includeFiles: false });
  assert.ok(directories.every((entry) => entry.kind === "directory"));
  const files = await searchWorkspaceEntries({ root, query: "", includeDirectories: false });
  assert.ok(files.every((entry) => entry.kind === "file"));
});
