import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attachImagePath, cleanupOldImages, saveBase64Image } from "./images.server.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUg==";

async function tempEnv(): Promise<{ env: Record<string, string>; imagesDir: string }> {
  const cache = await mkdtemp(path.join(os.tmpdir(), "claude-images-"));
  return {
    env: { XDG_CACHE_HOME: cache, HOME: cache },
    imagesDir: path.join(cache, "paseo-claude-code-cli-plugin", "images"),
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

test("copies an existing image and rejects other files", async () => {
  const { env, imagesDir } = await tempEnv();
  const source = path.join(env.XDG_CACHE_HOME!, "picture.png");
  await writeFile(source, Buffer.from(PNG_BASE64, "base64"));
  const copied = await attachImagePath(source, env);
  assert.equal(path.dirname(copied), imagesDir);

  const notAnImage = path.join(env.XDG_CACHE_HOME!, "notes.txt");
  await writeFile(notAnImage, "hello");
  await assert.rejects(() => attachImagePath(notAnImage, env), /png, jpg/);
});

test("deletes cached images older than a week", async () => {
  const { env } = await tempEnv();
  const fresh = await saveBase64Image("fresh.png", PNG_BASE64, env);
  const stale = await saveBase64Image("stale.png", PNG_BASE64, env);
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await utimes(stale, longAgo, longAgo);

  assert.equal(await cleanupOldImages(env), 1);
  await assert.rejects(() => stat(stale));
  assert.ok(await stat(fresh));
});
