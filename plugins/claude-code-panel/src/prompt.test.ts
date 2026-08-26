import assert from "node:assert/strict";
import test from "node:test";
import { composePrompt } from "./prompt.shared.ts";

test("normalizes newlines and trims the prompt", () => {
  assert.equal(composePrompt("  hello\r\nworld  ", []), "hello\nworld");
});

test("appends every attachment on a line of its own", () => {
  assert.equal(
    composePrompt("look at this", ["/cache/a.png", "https://example.test/pull/3"]),
    "look at this\n/cache/a.png\nhttps://example.test/pull/3",
  );
});

test("sends an attachment without text", () => {
  assert.equal(composePrompt("", ["/cache/a.png"]), "/cache/a.png");
});
