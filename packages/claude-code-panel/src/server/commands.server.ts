import { promises as fs } from "node:fs";
import path from "node:path";
import { readEnabledPlugins } from "./cli-settings.server.ts";
import { claudeHomeDir, type Env } from "./paths.server.ts";

/**
 * The slash commands a session can run, read off disk the way Claude Code reads them.
 * Its built-in commands are compiled into the binary and are deliberately not listed here: they
 * would be a copy of a list that changes with every release, and the CLI already offers them.
 */
export type SlashCommand = {
  /** What follows the slash, including a plugin's namespace. */
  name: string;
  description: string;
  source: "user" | "project" | "plugin";
  kind: "skill" | "command";
};

const FRONTMATTER_SCAN_BYTES = 8 * 1024;
const MAX_PROJECT_LEVELS = 12;
const MAX_COMMAND_DEPTH = 4;
const MAX_SKILL_DEPTH = 3;

/** Only the scalar keys, which is all a command file's frontmatter carries that the menu shows. */
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    fields[field[1]!] = field[2]!.trim().replace(/^["'](.*)["']$/, "$1");
  }
  return fields;
}

async function readFrontmatter(filePath: string): Promise<Record<string, string>> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(FRONTMATTER_SCAN_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return parseFrontmatter(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return {};
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function subdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) names.push(entry.name);
      // A skill directory is routinely a symlink into a shared checkout.
      else if (entry.isSymbolicLink() || entry.isFile()) {
        const stats = await fs.stat(path.join(directory, entry.name)).catch(() => null);
        if (stats?.isDirectory()) names.push(entry.name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

async function markdownFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth >= MAX_COMMAND_DEPTH) return [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
    else if (entry.isDirectory()) files.push(...(await markdownFiles(target, depth + 1)));
  }
  return files;
}

/** A skill is named after the directory holding its SKILL.md, however deep a plugin files it. */
async function skillsIn(
  directory: string,
  source: SlashCommand["source"],
  namespace: string | null,
  depth = 0,
): Promise<SlashCommand[]> {
  if (depth >= MAX_SKILL_DEPTH) return [];
  const commands: SlashCommand[] = [];
  for (const name of await subdirectories(directory)) {
    const file = path.join(directory, name, "SKILL.md");
    if (!(await fs.stat(file).catch(() => null))?.isFile()) {
      commands.push(...(await skillsIn(path.join(directory, name), source, namespace, depth + 1)));
      continue;
    }
    const fields = await readFrontmatter(file);
    // Only a plugin skill takes its command name from the frontmatter; elsewhere that is a label.
    const last = namespace === null ? name : (fields.name ?? name);
    commands.push({
      name: namespace === null ? last : `${namespace}:${last}`,
      description: fields.description ?? "",
      source,
      kind: "skill",
    });
  }
  return commands;
}

async function commandsIn(
  directory: string,
  source: SlashCommand["source"],
  namespace: string | null,
): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];
  for (const file of await markdownFiles(directory)) {
    const name = path.basename(file, ".md");
    const fields = await readFrontmatter(file);
    commands.push({
      name: namespace === null ? name : `${namespace}:${name}`,
      description: fields.description ?? "",
      source,
      kind: "command",
    });
  }
  return commands;
}

/** Project skills load from the working directory and every parent up to the repository root. */
export async function projectDirectories(workspaceDir: string): Promise<string[]> {
  const directories: string[] = [];
  let current = path.resolve(workspaceDir);
  for (let level = 0; level < MAX_PROJECT_LEVELS; level += 1) {
    directories.push(current);
    if ((await fs.stat(path.join(current, ".git")).catch(() => null)) !== null) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

type InstalledPlugin = { name: string; installPath: string };

/** Only the plugins the settings switched on, at the path the installer recorded for them. */
export async function installedPlugins(
  workspaceDir: string,
  env: Env = process.env,
): Promise<InstalledPlugin[]> {
  const [enabled, file] = await Promise.all([
    readEnabledPlugins(workspaceDir, env),
    fs
      .readFile(path.join(claudeHomeDir(env), "plugins", "installed_plugins.json"), "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null),
  ]);
  const plugins = (file as { plugins?: Record<string, { installPath?: string }[]> } | null)?.plugins;
  if (!plugins) return [];
  const installed: InstalledPlugin[] = [];
  for (const [key, entries] of Object.entries(plugins)) {
    if (!enabled.has(key)) continue;
    const installPath = entries[entries.length - 1]?.installPath;
    if (installPath) installed.push({ name: key.split("@")[0]!, installPath });
  }
  return installed;
}

/**
 * Names are unique, and the CLI's own precedence decides the winner: personal over project, a
 * skill over a command of the same name. A plugin is namespaced, so it never takes part.
 */
export async function listSlashCommands(
  workspaceDir: string,
  env: Env = process.env,
): Promise<SlashCommand[]> {
  const home = claudeHomeDir(env);
  const projects = await projectDirectories(workspaceDir);
  const layers: SlashCommand[][] = [
    await skillsIn(path.join(home, "skills"), "user", null),
    ...(await Promise.all(
      projects.map((directory) => skillsIn(path.join(directory, ".claude", "skills"), "project", null)),
    )),
    await commandsIn(path.join(home, "commands"), "user", null),
    ...(await Promise.all(
      projects.map((directory) =>
        commandsIn(path.join(directory, ".claude", "commands"), "project", null),
      ),
    )),
  ];

  for (const plugin of await installedPlugins(workspaceDir, env)) {
    layers.push(await skillsIn(path.join(plugin.installPath, "skills"), "plugin", plugin.name));
    layers.push(await commandsIn(path.join(plugin.installPath, "commands"), "plugin", plugin.name));
    const rootSkill = await readFrontmatter(path.join(plugin.installPath, "SKILL.md"));
    if (rootSkill.name !== undefined || rootSkill.description !== undefined) {
      layers.push([
        {
          name: `${plugin.name}:${rootSkill.name ?? path.basename(plugin.installPath)}`,
          description: rootSkill.description ?? "",
          source: "plugin",
          kind: "skill",
        },
      ]);
    }
  }

  const byName = new Map<string, SlashCommand>();
  for (const command of layers.flat()) {
    if (!byName.has(command.name)) byName.set(command.name, command);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
