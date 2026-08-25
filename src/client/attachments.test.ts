import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAttachment,
  fileAttachment,
  forgeAttachment,
  forgeOptionLabel,
  imageAttachment,
} from "./attachments.client.ts";

test("names an attachment after its file", () => {
  assert.deepEqual(imageAttachment("/cache/images/1-shot.png", "data:image/png;base64,AA"), {
    kind: "image",
    reference: "/cache/images/1-shot.png",
    title: "1-shot.png",
    subtitle: "Image",
    previewDataUrl: "data:image/png;base64,AA",
  });
  assert.equal(fileAttachment("/cache/files/1-notes.md").subtitle, "File");
});

test("labels an issue and a pull request the way the forge does", () => {
  const pull = forgeAttachment({
    kind: "pr",
    number: 12,
    title: "Fix paste",
    state: "open",
    url: "https://example.test/pull/12",
  });
  assert.equal(pull.subtitle, "PR #12");
  assert.equal(pull.reference, "https://example.test/pull/12");
  assert.equal(
    forgeOptionLabel({ kind: "issue", number: 3, title: "Crash", state: "open", url: "u" }),
    "#3 Crash",
  );
});

test("does not attach the same reference twice", () => {
  const first = [fileAttachment("/cache/files/notes.md")];
  assert.equal(addAttachment(first, fileAttachment("/cache/files/notes.md")), first);
  assert.equal(addAttachment(first, fileAttachment("/cache/files/other.md")).length, 2);
});
