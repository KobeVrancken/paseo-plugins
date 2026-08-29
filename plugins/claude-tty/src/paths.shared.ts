import os from "node:os";
import path from "node:path";

export type Env = Record<string, string | undefined>;

export const PLUGIN_ID = "claude-tty";
export const ADAPTER_PACKAGE = "@paseo-plugins/claude-tty-acp";
export const ADAPTER_BINARY_NAME = "claude-tty-acp";

/** Mirrors the adapter's own `defaultStateDirectory`; the plugin runs in the daemon and cannot import it. */
export function defaultStateDirectory(env: Env = process.env): string {
  const configured = env.CLAUDE_TTY_ACP_STATE_DIR?.trim();
  if (configured) return configured;
  const stateHome = env.XDG_STATE_HOME?.trim() || path.join(env.HOME || os.homedir(), ".local", "state");
  return path.join(stateHome, "claude-tty-acp");
}

export function sessionsDirectory(stateDirectory: string): string {
  return path.join(stateDirectory, "sessions");
}

export function locksDirectory(stateDirectory: string): string {
  return path.join(stateDirectory, "locks");
}

/** `plugins/claude-tty` sits two levels below the checkout whose adapter this plugin manages. */
export function repoRootFromPluginPath(pluginPath: string): string {
  return path.resolve(pluginPath, "..", "..");
}

export function adapterDirectory(repoRoot: string): string {
  return path.join(repoRoot, "apps", ADAPTER_BINARY_NAME);
}

export function adapterManifestPath(repoRoot: string): string {
  return path.join(adapterDirectory(repoRoot), "package.json");
}

export function adapterBinaryPath(repoRoot: string): string {
  return path.join(adapterDirectory(repoRoot), "bin", ADAPTER_BINARY_NAME);
}

/** The binary is a shell wrapper around this file, so its absence is what "not built yet" means. */
export function adapterEntryPath(repoRoot: string): string {
  return path.join(adapterDirectory(repoRoot), "dist", "cli.js");
}

/** Where a bare command name would be found, in the order a shell would try. */
export function executableCandidates(command: string, env: Env = process.env): string[] {
  if (command.includes(path.sep)) return [path.resolve(command)];
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry !== "")
    .map((entry) => path.join(entry, command));
}

/** `CLAUDE_BIN` wins over `PATH` for the adapter, so the plugin looks where the adapter would look. */
export function claudeCandidates(env: Env = process.env): string[] {
  const configured = env.CLAUDE_BIN?.trim();
  return configured ? [path.resolve(configured)] : executableCandidates("claude", env);
}
