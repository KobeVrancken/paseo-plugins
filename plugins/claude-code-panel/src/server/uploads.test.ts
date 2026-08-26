import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupOldUploads,
  imagePreviewDataUrl,
  resolveAttachmentPath,
  saveBase64File,
  saveBase64Image,
} from "./uploads.server.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUg==";

async function tempEnv(): Promise<{
  env: Record<string, string>;
  imagesDir: string;
  filesDir: string;
}> {
  const cache = await mkdtemp(path.join(os.tmpdir(), "claude-images-"));
  return {
    env: { XDG_CACHE_HOME: cache, HOME: cache },
    imagesDir: path.join(cache, "paseo-plugins", "claude-code-panel", "images"),
    filesDir: path.join(cache, "paseo-plugins", "claude-code-panel", "files"),
  };
}

test("writes an uploaded image into the plugin cache", async () => {
  const { env, imagesDir } = await tempEnv();
  const written = await saveBase64Image("shot.png", PNG_BASE64, env);
  assert.equal(path.dirname(written), imagesDir);
  assert.match(path.basename(written), /^\d+-shot\.png$/);
  assert.equal((await readFile(written)).toString("base64"), PNG_BASE64);
});

test("sanitizes hostile file names", async () => {
  const { env, imagesDir } = await tempEnv();
  const written = await saveBase64Image("../../etc/passwd", PNG_BASE64, env);
  assert.equal(path.dirname(written), imagesDir);
  assert.match(path.basename(written), /passwd\.png$/);
});

test("attaches a file the user named where it already is", async () => {
  const { env } = await tempEnv();
  const picture = path.join(env.XDG_CACHE_HOME!, "picture.png");
  await writeFile(picture, Buffer.from(PNG_BASE64, "base64"));
  assert.deepEqual(await resolveAttachmentPath(picture, env), { path: picture, kind: "image" });

  const notes = path.join(env.XDG_CACHE_HOME!, "notes.txt");
  await writeFile(notes, "hello");
  assert.deepEqual(await resolveAttachmentPath(`  ${notes}  `, env), { path: notes, kind: "file" });

  await assert.rejects(() => resolveAttachmentPath(env.XDG_CACHE_HOME!, env), /not a file/);
});

test("expands a leading ~ against the home directory", async () => {
  const { env } = await tempEnv();
  const notes = path.join(env.HOME!, "notes.txt");
  await writeFile(notes, "hello");
  const attached = await resolveAttachmentPath("~/notes.txt", env);
  assert.equal(attached.path, notes);
});

test("deletes cached images older than a week", async () => {
  const { env } = await tempEnv();
  const fresh = await saveBase64Image("fresh.png", PNG_BASE64, env);
  const stale = await saveBase64Image("stale.png", PNG_BASE64, env);
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await utimes(stale, longAgo, longAgo);

  assert.equal(await cleanupOldUploads(env), 1);
  await assert.rejects(() => stat(stale));
  assert.ok(await stat(fresh));
});

test("inlines a small image as a preview and skips anything else", async () => {
  const { env } = await tempEnv();
  const written = await saveBase64Image("shot.png", PNG_BASE64, env);
  assert.equal(await imagePreviewDataUrl(written), `data:image/png;base64,${PNG_BASE64}`);

  const notAnImage = path.join(env.XDG_CACHE_HOME!, "notes.txt");
  await writeFile(notAnImage, "hello");
  assert.equal(await imagePreviewDataUrl(notAnImage), null);
  assert.equal(await imagePreviewDataUrl(path.join(env.XDG_CACHE_HOME!, "gone.png")), null);
});

test("leaves a large image without a preview", async () => {
  const { env } = await tempEnv();
  const big = await saveBase64Image("big.png", Buffer.alloc(2_000_000, 1).toString("base64"), env);
  assert.equal(await imagePreviewDataUrl(big), null);
});

test("keeps a non-image upload under its own name", async () => {
  const { env, filesDir } = await tempEnv();
  const written = await saveBase64File("notes.md", Buffer.from("# hi").toString("base64"), env);
  assert.equal(path.dirname(written), filesDir);
  assert.match(path.basename(written), /^\d+-notes\.md$/);
  assert.equal((await readFile(written)).toString(), "# hi");
  await assert.rejects(() => saveBase64File("empty.md", "", env), /empty/);
});
