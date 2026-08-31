import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const EXEC_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;

export class PaseoCliError extends Error {
  readonly args: string[];

  constructor(message: string, args: string[]) {
    super(message);
    this.name = "PaseoCliError";
    this.args = args;
  }
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The plugin runs inside the daemon's process tree, whose PATH does not necessarily contain the
 * bundled CLI, so fall back to the paths of the app bundle that is running us.
 */
function bundledCliCandidates(): string[] {
  const executableDir = path.dirname(process.execPath);
  return [
    path.join(executableDir, "resources", "bin", "paseo"),
    path.join(executableDir, "..", "Resources", "bin", "paseo"),
    "/opt/Paseo/resources/bin/paseo",
    "/usr/local/bin/paseo",
  ];
}

let cachedBinary: string | null = null;

export function resolvePaseoBinary(env: NodeJS.ProcessEnv = process.env): string {
  if (cachedBinary) return cachedBinary;
  const explicit = env.PASEO_BIN?.trim() || env.PASEO_CLI?.trim();
  if (explicit) {
    cachedBinary = explicit;
    return explicit;
  }
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, "paseo");
    if (isExecutable(candidate)) {
      cachedBinary = candidate;
      return candidate;
    }
  }
  for (const candidate of bundledCliCandidates()) {
    if (isExecutable(candidate)) {
      cachedBinary = candidate;
      return candidate;
    }
  }
  cachedBinary = "paseo";
  return cachedBinary;
}

async function paseo(args: string[]): Promise<string> {
  const binary = resolvePaseoBinary();
  try {
    const { stdout } = await run(binary, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      throw new PaseoCliError(
        `the paseo CLI was not found at "${binary}" — set PASEO_BIN to its path`,
        args,
      );
    }
    // The CLI reports a refused password as though the daemon were not running at all, and its
    // advice ("Start the daemon with: paseo daemon start") sends you looking in the wrong place.
    if (message.includes("Password required")) {
      throw new PaseoCliError(
        `\`paseo ${args.join(" ")}\` was refused: the daemon has a password set, so PASEO_PASSWORD must be in the environment it spawns plugins with`,
        args,
      );
    }
    throw new PaseoCliError(`\`paseo ${args.join(" ")}\` failed: ${message}`, args);
  }
}

async function paseoJson<Value>(args: string[]): Promise<Value> {
  const stdout = await paseo([...args, "--json"]);
  try {
    return JSON.parse(stdout) as Value;
  } catch {
    throw new PaseoCliError(`\`paseo ${args.join(" ")}\` returned unparseable JSON`, args);
  }
}

export type TerminalRow = { id: string; name: string; cwd: string };

export async function listTerminals(cwd?: string): Promise<TerminalRow[]> {
  const args = cwd ? ["terminal", "ls", "--cwd", cwd] : ["terminal", "ls", "--all"];
  const rows = await paseoJson<TerminalRow[]>(args);
  return Array.isArray(rows) ? rows : [];
}

export async function createTerminal(cwd: string, name: string): Promise<TerminalRow> {
  return paseoJson<TerminalRow>(["terminal", "create", "--cwd", cwd, "--name", name]);
}

/**
 * Key tokens (`Enter`, `Escape`, …) are concatenated without separators before being written to the
 * PTY; `literal` turns the mapping off so prompt text containing the word "Enter" is not translated.
 */
export async function sendKeys(terminalId: string, keys: string[], literal = false): Promise<void> {
  // `--` keeps prompt text that starts with a dash from being parsed as a CLI option.
  const args = ["terminal", "send-keys", terminalId, ...(literal ? ["--literal"] : []), "--", ...keys];
  await paseo(args);
}

export async function captureTerminal(terminalId: string): Promise<string[]> {
  const payload = await paseoJson<{ lines?: string[] }>(["terminal", "capture", terminalId]);
  return payload.lines ?? [];
}
