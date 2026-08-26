import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listSlashCommands, parseFrontmatter } from "./commands.server.ts";

async function skill(file: string, name: string, description: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

async function fixture(): Promise<{ home: string; workspace: string; env: Record<string, string> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-commands-"));
  const home = path.join(root, "claude");
  const workspace = path.join(root, "repo");
  const shared = path.join(root, "shared", "review");
  await mkdir(path.join(workspace, ".git"), { recursive: true });

  await skill(path.join(home, "skills", "git-commit", "SKILL.md"), "git-commit", "Write a commit");
  await skill(path.join(home, "skills", "deploy", "SKILL.md"), "deploy", "The personal one");
  await skill(path.join(workspace, ".claude", "skills", "deploy", "SKILL.md"), "deploy", "The project one");
  await skill(path.join(shared, "SKILL.md"), "review", "A linked skill");
  await symlink(shared, path.join(home, "skills", "review"), "dir");
  await mkdir(path.join(home, "commands"), { recursive: true });
  await writeFile(path.join(home, "commands", "git-commit.md"), "the command a skill outranks\n");
  await mkdir(path.join(workspace, ".claude", "commands"), { recursive: true });
  await writeFile(
    path.join(workspace, ".claude", "commands", "ship.md"),
    "---\ndescription: Ship it\n---\n",
  );

  const installPath = path.join(root, "plugins", "codex");
  await skill(path.join(installPath, "skills", "group", "rescue", "SKILL.md"), "rescue", "Ask codex");
  await mkdir(path.join(home, "plugins"), { recursive: true });
  await writeFile(
    path.join(home, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { "codex@market": [{ installPath }], "off@market": [{ installPath }] } }),
  );
  await writeFile(
    path.join(home, "settings.json"),
    JSON.stringify({ enabledPlugins: { "codex@market": true, "off@market": false } }),
  );
  return { home, workspace, env: { CLAUDE_CONFIG_DIR: home, HOME: root } };
}

test("reads the scalar fields out of frontmatter", () => {
  assert.deepEqual(parseFrontmatter('---\nname: "git-commit"\ndescription: Do it\n---\nbody'), {
    name: "git-commit",
    description: "Do it",
  });
  assert.deepEqual(parseFrontmatter("# no frontmatter"), {});
});

test("lists skills and commands the way the CLI resolves them", async () => {
  const { workspace, env } = await fixture();
  const commands = await listSlashCommands(workspace, env);
  const byName = new Map(commands.map((command) => [command.name, command]));

  assert.equal(byName.get("git-commit")?.kind, "skill", "a skill outranks a command of the same name");
  assert.equal(byName.get("deploy")?.description, "The personal one", "personal outranks project");
  assert.equal(byName.get("review")?.description, "A linked skill", "a symlinked skill is read");
  assert.equal(byName.get("ship")?.description, "Ship it");
  assert.equal(byName.get("ship")?.source, "project");
  assert.equal(byName.get("codex:rescue")?.description, "Ask codex", "a plugin skill is namespaced");
  assert.equal(byName.has("rescue"), false, "and only reachable through its namespace");
  assert.equal(byName.has("off:rescue"), false, "a disabled plugin contributes nothing");
  assert.deepEqual(
    commands.map((command) => command.name),
    [...commands.map((command) => command.name)].sort(),
  );
});
