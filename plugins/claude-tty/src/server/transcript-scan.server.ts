import { open, stat } from "node:fs/promises";

/** Enough of the head of a file to know it again, so a rewrite of the same size is still noticed. */
const SIGNATURE_BYTES = 256;

/**
 * How far into a file this has read, and what the file looked like when it did. Claude's transcripts
 * are appended to for as long as the session lives and run to megabytes, and the panel polls them,
 * so they are read the way the adapter reads them: once from the beginning, then only what is new.
 */
export type FileScan = {
  offset: number;
  signature: string;
  signatureBytes: number;
};

export function newScan(): FileScan {
  return { offset: 0, signature: "", signatureBytes: 0 };
}

/**
 * The whole lines written since the last read, and whether the file was rewritten under the scan
 * before them — a compaction can land on the same size or a larger one, so what identifies the file
 * is the head of it rather than its length. The last line of a file being appended to is
 * half-written, so it is left where it is until the read that finds the rest of it.
 */
export async function readNewLines(file: string, scan: FileScan): Promise<{ text: string; rewritten: boolean }> {
  const size = (await stat(file)).size;
  const rewritten = await rewind(file, scan, size);
  if (size <= scan.offset) return { text: "", rewritten };
  const chunk = await readRange(file, scan.offset, size - scan.offset);
  const complete = chunk.lastIndexOf("\n");
  if (complete < 0) return { text: "", rewritten };
  scan.offset += Buffer.byteLength(chunk.slice(0, complete + 1));
  return { text: chunk.slice(0, complete), rewritten };
}

export async function readHead(file: string, length: number): Promise<string> {
  return readRange(file, 0, length);
}

export async function readWhole(file: string): Promise<string | null> {
  const handle = await open(file, "r").catch(() => null);
  if (handle === null) return null;
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function rewind(file: string, scan: FileScan, size: number): Promise<boolean> {
  const comparable = scan.offset > 0 ? scan.signatureBytes : Math.min(SIGNATURE_BYTES, size);
  const signature = await readRange(file, 0, comparable);
  if (size < scan.offset || (scan.offset > 0 && signature !== scan.signature)) {
    scan.offset = 0;
    scan.signatureBytes = Math.min(SIGNATURE_BYTES, size);
    scan.signature = await readRange(file, 0, scan.signatureBytes);
    return true;
  }
  if (scan.offset === 0) {
    scan.signatureBytes = comparable;
    scan.signature = signature;
  }
  return false;
}

async function readRange(file: string, start: number, length: number): Promise<string> {
  if (length <= 0) return "";
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}
