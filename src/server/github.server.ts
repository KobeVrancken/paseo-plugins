import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const EXEC_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const FIELDS = "number,title,state,url";

export type ForgeItemKind = "issue" | "pr";

export type ForgeItem = {
  kind: ForgeItemKind;
  number: number;
  title: string;
  state: string;
  url: string;
};

export type ForgeSearch = { items: ForgeItem[]; warning: string | null };

/**
 * `gh issue list` and `gh pr list` both take `--search`, which is what the GitHub search box takes,
 * so a bare word narrows by title and a qualifier like `author:@me` still works.
 */
export function listArgs(kind: ForgeItemKind, query: string, limit: number): string[] {
  const trimmed = query.trim();
  const args = [kind === "pr" ? "pr" : "issue", "list", "--state", "all", "--limit", String(limit)];
  args.push("--json", FIELDS);
  if (trimmed !== "") args.push("--search", trimmed);
  return args;
}

export function parseForgeItems(stdout: string, kind: ForgeItemKind): ForgeItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: ForgeItem[] = [];
  for (const row of parsed) {
    const record = row as Record<string, unknown>;
    if (typeof record.number !== "number" || typeof record.url !== "string") continue;
    items.push({
      kind,
      number: record.number,
      title: typeof record.title === "string" ? record.title : "",
      state: typeof record.state === "string" ? record.state.toLowerCase() : "",
      url: record.url,
    });
  }
  return items;
}

/** What went wrong is worth repeating verbatim: `gh` explains missing auth and missing remotes well. */
export function warningFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) return "the GitHub CLI (gh) is not installed";
  const detail = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("Command failed"));
  return detail ?? "the GitHub CLI could not list this repository";
}

async function listKind(
  workspaceDir: string,
  kind: ForgeItemKind,
  query: string,
  limit: number,
): Promise<ForgeItem[]> {
  const { stdout } = await run("gh", listArgs(kind, query, limit), {
    cwd: workspaceDir,
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return parseForgeItems(stdout, kind);
}

export function sortForgeItems(items: ForgeItem[]): ForgeItem[] {
  return [...items].sort((left, right) => right.number - left.number);
}

export async function searchForgeItems(
  workspaceDir: string,
  query: string,
  limit: number,
): Promise<ForgeSearch> {
  const [issues, pulls] = await Promise.allSettled([
    listKind(workspaceDir, "issue", query, limit),
    listKind(workspaceDir, "pr", query, limit),
  ]);
  const items = sortForgeItems([
    ...(issues.status === "fulfilled" ? issues.value : []),
    ...(pulls.status === "fulfilled" ? pulls.value : []),
  ]).slice(0, limit);
  if (issues.status === "rejected" && pulls.status === "rejected") {
    return { items: [], warning: warningFor(issues.reason) };
  }
  return { items, warning: null };
}
