import { promises as fs } from "node:fs";
import path from "node:path";
import { filesDir, imagesDir, type Env } from "./paths.server.ts";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;
/** Above this the composer keeps the file's name and drops the thumbnail rather than inline megabytes. */
const PREVIEW_MAX_BYTES = 1_500_000;

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_TYPES));

export function imageMimeType(filePath: string): string | null {
  return IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

/** The panel cannot read a file itself, so an image it has to draw travels inline. */
export async function imageDataUrl(filePath: string, maxBytes: number): Promise<string | null> {
  const mimeType = imageMimeType(filePath);
  if (!mimeType) return null;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > maxBytes) return null;
    return `data:${mimeType};base64,${(await fs.readFile(filePath)).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The thumbnail beside the prompt. The full image is only worth sending once it is opened. */
export function imagePreviewDataUrl(filePath: string): Promise<string | null> {
  return imageDataUrl(filePath, PREVIEW_MAX_BYTES);
}

export function fullImageDataUrl(filePath: string): Promise<string | null> {
  return imageDataUrl(filePath, MAX_BYTES);
}

/** Uploads land in a shared directory, so the timestamp is what keeps two of the same name apart. */
function safeName(fileName: string, fallbackExtension: string | null): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const extension = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - extension.length) || "upload";
  const suffix = fallbackExtension === null || IMAGE_EXTENSIONS.has(extension) ? extension : fallbackExtension;
  return `${Date.now()}-${stem}${suffix}`;
}

/** Forwarded files are copies, so they are cleaned up on a timer rather than tracked per prompt. */
export async function cleanupOldUploads(env: Env = process.env, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const dir of [imagesDir(env), filesDir(env)]) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const target = path.join(dir, name);
      try {
        const stat = await fs.stat(target);
        if (now - stat.mtimeMs < MAX_AGE_MS) continue;
        await fs.unlink(target);
        removed += 1;
      } catch {
        continue;
      }
    }
  }
  return removed;
}

export async function saveBase64Image(
  fileName: string,
  base64: string,
  env: Env = process.env,
): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("image is empty");
  if (buffer.byteLength > MAX_BYTES) throw new Error("image is larger than 10 MB");
  const dir = imagesDir(env);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safeName(fileName, ".png"));
  await fs.writeFile(target, buffer);
  return target;
}

/**
 * Anything that is not an image, saved so the CLI can read it from a path.
 * The extension is kept as it came, because that is all the CLI has to go on.
 */
export async function saveBase64File(
  fileName: string,
  base64: string,
  env: Env = process.env,
): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("file is empty");
  if (buffer.byteLength > MAX_BYTES) throw new Error("file is larger than 10 MB");
  const dir = filesDir(env);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safeName(fileName, null));
  await fs.writeFile(target, buffer);
  return target;
}

export type AttachedFile = { path: string; kind: "image" | "file" };

/**
 * Copies a file the user pointed at into the cache, so the path the prompt names stays valid for as
 * long as the CLI might read it, whatever happens to the original.
 */
export async function attachFilePath(
  sourcePath: string,
  env: Env = process.env,
): Promise<AttachedFile> {
  const resolved = sourcePath.replace(/^~(?=\/)/, env.HOME ?? "~").trim();
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("not a file");
  if (stat.size > MAX_BYTES) throw new Error("the file is larger than 10 MB");
  const isImage = IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase());
  const dir = isImage ? imagesDir(env) : filesDir(env);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safeName(path.basename(resolved), null));
  await fs.copyFile(resolved, target);
  return { path: target, kind: isImage ? "image" : "file" };
}
