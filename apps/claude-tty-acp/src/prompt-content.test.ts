import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupPromptFiles, materializePrompt } from "./prompt-content.ts";

test("materializes images, local links, and bounded resources", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prompt-content-test-"));
  try {
    const result = await materializePrompt(
      [
        { type: "text", text: "Inspect these" },
        { type: "image", mimeType: "image/png", data: Buffer.from("image").toString("base64") },
        { type: "resource_link", uri: "src/app.ts", name: "app.ts" },
        { type: "resource", resource: { uri: "memory://notes", mimeType: "text/plain", text: "notes" } },
      ],
      directory,
      "/work/project",
    );
    assert.match(result.text, /Inspect these/);
    assert.match(result.text, /@\/work\/project\/src\/app\.ts/);
    assert.match(result.text, /<resource uri="memory:\/\/notes">/);
    assert.equal(await readFile(result.files[0]!, "utf8"), "image");
    assert.equal((await stat(result.files[0]!)).mode & 0o777, 0o600);
    await cleanupPromptFiles(result.files);
    await assert.rejects(stat(result.files[0]!), /ENOENT/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects audio and non-local links", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prompt-content-test-"));
  try {
    await assert.rejects(materializePrompt([{ type: "audio", mimeType: "audio/wav", data: "" }], directory, "/work"), /audio prompt content/);
    await assert.rejects(
      materializePrompt([{ type: "resource_link", uri: "https://example.com/file", name: "file" }], directory, "/work"),
      /not a host-local file/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
