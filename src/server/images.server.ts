import { promises as fs } from "node:fs";
import path from "node:path";
import { imagesDir, type Env } from "./paths.server.ts";

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

/** The thumbnail the composer shows next to a prompt, inlined because the panel cannot read files. */
export async function imagePreviewDataUrl(filePath: string): Promise<string | null> {
  const mimeType = imageMimeType(filePath);
  if (!mimeType) return null;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > PREVIEW_MAX_BYTES) return null;
    return `data:${mimeType};base64,${(await fs.readFile(filePath)).toString("base64")}`;
  } catch {
    return null;
  }
}

function safeName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const extension = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - extension.length) || "image";
  const suffix = IMAGE_EXTENSIONS.has(extension) ? extension : ".png";
  return `${Date.now()}-${stem}${suffix}`;
}

/** Forwarded images are copies, so they are cleaned up on a timer rather than tracked per prompt. */
export async function cleanupOldImages(env: Env = process.env, now = Date.now()): Promise<number> {
  const dir = imagesDir(env);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
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
  const target = path.join(dir, safeName(fileName));
  await fs.writeFile(target, buffer);
  return target;
}

/** Copies an image the user pointed at into the cache so the path stays valid for the CLI. */
export async function attachImagePath(sourcePath: string, env: Env = process.env): Promise<string> {
  const resolved = sourcePath.replace(/^~(?=\/)/, env.HOME ?? "~").trim();
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("not a file");
  if (stat.size > MAX_BYTES) throw new Error("image is larger than 10 MB");
  if (!IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("not a png, jpg, gif or webp file");
  }
  const dir = imagesDir(env);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safeName(path.basename(resolved)));
  await fs.copyFile(resolved, target);
  return target;
}
