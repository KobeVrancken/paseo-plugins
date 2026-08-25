import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base64FromDataUrl,
  isPasteableImage,
  pastedImageName,
  pastedImages,
  type PastedClipboard,
  type PastedFile,
} from "./clipboard-image.client.ts";

function item(kind: string, type: string, file: PastedFile | null) {
  return { kind, type, getAsFile: () => file };
}

test("takes image files off the clipboard items", () => {
  const screenshot = { name: "image.png", type: "image/png" };
  const clipboard: PastedClipboard = {
    items: [item("string", "text/html", null), item("file", "image/png", screenshot)],
  };
  assert.deepEqual(pastedImages(clipboard), [screenshot]);
});

test("ignores pasted files that are not images", () => {
  const clipboard: PastedClipboard = {
    items: [item("file", "application/pdf", { name: "report.pdf", type: "application/pdf" })],
    files: [{ name: "report.pdf", type: "application/pdf" }],
  };
  assert.deepEqual(pastedImages(clipboard), []);
});

test("falls back to the file list when no item carries the image", () => {
  const file = { name: "shot.webp", type: "image/webp" };
  assert.deepEqual(pastedImages({ items: [], files: [file] }), [file]);
});

test("names an unnamed screenshot after its type", () => {
  assert.equal(pastedImageName({ type: "image/png" }), "clipboard.png");
  assert.equal(pastedImageName({ name: "  ", type: "image/jpeg" }), "clipboard.jpg");
  assert.equal(pastedImageName({ name: "diagram.gif", type: "image/gif" }), "diagram.gif");
});

test("knows which types the CLI accepts", () => {
  assert.equal(isPasteableImage("image/PNG"), true);
  assert.equal(isPasteableImage("image/svg+xml"), false);
});

test("reads the payload out of a data url", () => {
  assert.equal(base64FromDataUrl("data:image/png;base64,AAAB"), "AAAB");
  assert.equal(base64FromDataUrl("data:image/png,raw"), null);
});
