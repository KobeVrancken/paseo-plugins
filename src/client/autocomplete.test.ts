import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFileMention,
  applySlashCommand,
  fallbackIndex,
  findActiveFileMention,
  findActiveSlashCommand,
  nextIndex,
  orderOptions,
} from "./autocomplete.client.ts";

test("finds the mention the cursor is sitting in", () => {
  assert.deepEqual(findActiveFileMention({ text: "look at @src/pa", cursorIndex: 15 }), {
    start: 8,
    end: 15,
    query: "src/pa",
  });
  assert.deepEqual(findActiveFileMention({ text: "@", cursorIndex: 1 }), {
    start: 0,
    end: 1,
    query: "",
  });
});

test("drops the mention once the word ends", () => {
  assert.equal(findActiveFileMention({ text: "@src/panel.ts and", cursorIndex: 17 }), null);
  assert.equal(findActiveFileMention({ text: "no mention here", cursorIndex: 15 }), null);
  assert.equal(findActiveFileMention({ text: "mail@example.test", cursorIndex: 17 })?.query, "example.test");
});

test("opens the command menu only at the start of a word", () => {
  assert.equal(findActiveSlashCommand({ text: "/git", cursorIndex: 4 })?.position, "start");
  assert.equal(findActiveSlashCommand({ text: "run /git", cursorIndex: 8 })?.position, "inline");
  assert.equal(findActiveSlashCommand({ text: "src/panel", cursorIndex: 9 }), null);
  assert.equal(findActiveSlashCommand({ text: "/a/b", cursorIndex: 4 }), null);
});

test("replaces a mention, and keeps the menu open on a directory", () => {
  const text = "look at @src/pa";
  const mention = findActiveFileMention({ text, cursorIndex: text.length })!;
  assert.equal(
    applyFileMention({ text, mention, path: "src/panel.ts", kind: "file" }),
    "look at @src/panel.ts ",
  );
  assert.equal(
    applyFileMention({ text, mention, path: "src/parts", kind: "directory" }),
    "look at @src/parts/",
  );
});

test("replaces a command and leaves room for its arguments", () => {
  const text = "/gc";
  const command = findActiveSlashCommand({ text, cursorIndex: 3 })!;
  assert.equal(applySlashCommand({ text, command, name: "git-commit" }), "/git-commit ");
  assert.equal(
    applySlashCommand({ text: "/gc now", command, name: "git-commit" }),
    "/git-commit now",
  );
});

test("walks the list, wrapping at both ends", () => {
  assert.deepEqual(orderOptions(["a", "b", "c"]), ["c", "b", "a"]);
  assert.equal(fallbackIndex(3), 2);
  assert.equal(fallbackIndex(0), -1);
  assert.equal(nextIndex({ currentIndex: -1, count: 3, key: "ArrowUp" }), 2);
  assert.equal(nextIndex({ currentIndex: 2, count: 3, key: "ArrowDown" }), 0);
  assert.equal(nextIndex({ currentIndex: 0, count: 3, key: "ArrowUp" }), 2);
  assert.equal(nextIndex({ currentIndex: 0, count: 0, key: "ArrowUp" }), -1);
});
