import { promises as fs } from "node:fs";
import path from "node:path";
import { compareMatchScores, scoreMatch, type MatchScore } from "../text-match.shared.ts";

export type EntryKind = "file" | "directory";

export type WorkspaceEntry = { path: string; kind: EntryKind };

const DEFAULT_LIMIT = 30;
const MAX_DEPTH = 12;
const MAX_ENTRIES_SCANNED = 20_000;

/** Directories nobody means when they type `@`, whether or not the repository ignores them. */
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "env",
  "node_modules",
  "out",
  "target",
  "vendor",
  "venv",
  "virtualenv",
]);

/** The dot directories that hold things people do mention, unlike the rest. */
const TRAVERSABLE_HIDDEN_DIRECTORIES = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".github",
  ".opencode",
  ".paseo",
  ".vscode",
]);

/** `src/comp` browses `src`; `comp` searches the tree. The trailing segment is always the term. */
export function splitQuery(query: string): { directory: string; term: string } {
  const normalized = query.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  const cut = normalized.lastIndexOf("/");
  if (cut === -1) return { directory: "", term: normalized };
  return { directory: normalized.slice(0, cut), term: normalized.slice(cut + 1) };
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function skipsDirectory(name: string, term: string): boolean {
  if (IGNORED_DIRECTORY_NAMES.has(name)) return true;
  if (!isHidden(name)) return false;
  return !TRAVERSABLE_HIDDEN_DIRECTORIES.has(name) && !term.startsWith(".");
}

type Child = WorkspaceEntry & { link: boolean };

async function readChildren(directory: string): Promise<Child[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const children: Child[] = [];
  for (const entry of entries) {
    let kind: EntryKind | null = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : null;
    if (entry.isSymbolicLink()) {
      // A skill directory is routinely a symlink, and so is a linked package.
      kind = await fs
        .stat(path.join(directory, entry.name))
        .then((stats) => (stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null))
        .catch(() => null);
    }
    if (kind) children.push({ path: entry.name, kind, link: entry.isSymbolicLink() });
  }
  return children;
}

type Ranked = { entry: WorkspaceEntry; score: MatchScore; depth: number };

function byRank(left: Ranked, right: Ranked): number {
  const score = compareMatchScores(left.score, right.score);
  if (score !== 0) return score;
  if (left.depth !== right.depth) return left.depth - right.depth;
  return left.entry.path.localeCompare(right.entry.path);
}

/**
 * The name is what the user is typing, so a hit there beats a hit anywhere else in the path.
 * A shallow entry wins the tie, which is what makes `@readme` offer the repository's own first.
 */
function rank(entry: WorkspaceEntry, term: string, depth: number): Ranked | null {
  const name = entry.path.split("/").pop() ?? entry.path;
  const score = scoreMatch(term, name);
  if (score) return { entry, score, depth };
  const pathScore = term.includes("/") ? null : scoreMatch(term, entry.path);
  return pathScore ? { entry, score: { ...pathScore, tier: pathScore.tier + 6 }, depth } : null;
}

function wanted(kind: EntryKind, includeFiles: boolean, includeDirectories: boolean): boolean {
  return kind === "file" ? includeFiles : includeDirectories;
}

export type SearchOptions = {
  root: string;
  query: string;
  limit?: number;
  includeFiles?: boolean;
  includeDirectories?: boolean;
};

export async function searchWorkspaceEntries(options: SearchOptions): Promise<WorkspaceEntry[]> {
  const includeFiles = options.includeFiles ?? true;
  const includeDirectories = options.includeDirectories ?? true;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const root = path.resolve(options.root);
  const { directory, term } = splitQuery(options.query);

  const base = path.resolve(root, directory);
  if (base !== root && !base.startsWith(`${root}${path.sep}`)) return [];

  const browsing = directory !== "" || term === "";
  const ranked: Ranked[] = [];
  let scanned = 0;

  // Naming a directory means browsing it; a bare word searches the tree from the top, shallow first.
  const queue: { directory: string; visible: string; depth: number }[] = [
    { directory: base, visible: directory, depth: 0 },
  ];
  while (queue.length > 0 && scanned < MAX_ENTRIES_SCANNED) {
    const current = queue.shift()!;
    for (const child of await readChildren(current.directory)) {
      scanned += 1;
      const visible = current.visible === "" ? child.path : `${current.visible}/${child.path}`;
      const skip = child.kind === "directory" && skipsDirectory(child.path, term);
      if (!skip && wanted(child.kind, includeFiles, includeDirectories)) {
        const scored = rank({ path: visible, kind: child.kind }, term, current.depth);
        if (scored) ranked.push(scored);
      }
      // A symlinked directory is browsable by name but never walked into, so a loop cannot be one.
      if (browsing || skip || child.link || child.kind !== "directory") continue;
      if (current.depth + 1 < MAX_DEPTH) {
        queue.push({
          directory: path.join(current.directory, child.path),
          visible,
          depth: current.depth + 1,
        });
      }
    }
  }

  return ranked
    .sort(byRank)
    .slice(0, limit)
    .map((entry) => entry.entry);
}
