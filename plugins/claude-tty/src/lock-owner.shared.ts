import { ADAPTER_BINARY_NAME, ADAPTER_ENTRY_NAME } from "./paths.shared.ts";
import type { SessionLock } from "./sessions.shared.ts";

/**
 * The adapter runs as `node <checkout>/apps/claude-tty-acp/<...>/cli.js`. Matching that as one path
 * rather than as two substrings anywhere in the line is what keeps the `claude` child out: it is
 * handed a `--settings` path carrying the adapter's name, and is itself `node <...>/cli.js` wherever
 * Claude Code is installed as a bundle rather than as a binary.
 *
 * Built from the names the plugin registers the adapter under, so renaming either cannot leave a
 * guard behind that still matches the old one.
 */
const ADAPTER_COMMAND = new RegExp(
  `(?:^|/)${quote(ADAPTER_BINARY_NAME)}/\\S*/${quote(ADAPTER_ENTRY_NAME)}(?:\\s|$)`,
);

function quote(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How far a process may appear to have started after its own lock before it reads as a different
 * process. `ps` truncates to the second and a boot-time reading drifts against the wall clock, so
 * the comparison needs slack; PIDs take far longer than this to come round again.
 */
const START_SLACK_MS = 5_000;

/** What a stop has to know about the process a lock names before it will signal it. */
export type ProcessIdentity = {
  command: string;
  /** Epoch ms the process started, or null on a host that would not say. */
  startedAt: number | null;
  /** Already exited and waiting to be reaped, which no signal can help. */
  zombie: boolean;
};

export function isAdapterCommand(command: string): boolean {
  return ADAPTER_COMMAND.test(command);
}

/**
 * A PID outlives the process that earned it, so the owner of a lock is identified rather than
 * assumed. Two live processes cannot share a PID, so a process that was already running when the
 * lock was written and still holds that PID is the process that wrote it — which is what makes the
 * start time worth more than the command line, and what keeps a *second* adapter that inherited the
 * PID from being mistaken for this one.
 */
export function ownsLock(identity: ProcessIdentity, lock: SessionLock): boolean {
  if (identity.zombie || !isAdapterCommand(identity.command)) return false;
  return identity.startedAt !== null && identity.startedAt <= lock.createdAt + START_SLACK_MS;
}
