import { promises as fs, watch, type FSWatcher } from "node:fs";

/** Used only where the kernel will not tell us: no inotify watch, or a file that is not there yet. */
const STAT_POLL_MS = 250;

export type FileSnapshot = { size: number; mtimeMs: number } | null;

/** Null for a file that does not exist, which is a state worth waiting on: it is about to. */
export async function snapshotFile(filePath: string): Promise<FileSnapshot> {
  try {
    const stat = await fs.stat(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function snapshotsDiffer(left: FileSnapshot, right: FileSnapshot): boolean {
  if (left === null || right === null) return left !== right;
  return left.size !== right.size || left.mtimeMs !== right.mtimeMs;
}

/**
 * Resolves as soon as the file no longer matches `since`, or when the wait runs out.
 * The caller takes its snapshot before reading the file, so an append that lands while it is reading
 * is caught by the first comparison here rather than waited on.
 */
export async function waitForFileChange(
  filePath: string,
  since: FileSnapshot,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let watcher: FSWatcher | null = null;
  let wake: (() => void) | null = null;
  try {
    watcher = watch(filePath, () => wake?.());
  } catch {
    watcher = null;
  }
  try {
    for (;;) {
      if (snapshotsDiffer(await snapshotFile(filePath), since)) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
        const timer = setTimeout(finish, watcher ? remaining : Math.min(remaining, STAT_POLL_MS));
        wake = finish;
      });
    }
  } finally {
    watcher?.close();
  }
}
