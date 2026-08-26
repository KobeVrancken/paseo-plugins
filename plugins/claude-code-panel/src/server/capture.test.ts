import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { looksLikeClaudeSession, parseDialog, parsePermissionMode } from "./capture.server.ts";
import { answerKeys, ARROW_RIGHT, metaOptionKeys } from "./keymap.server.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function capture(name: string): string[] {
  return readFileSync(path.join(fixturesDir, name), "utf8").split("\n");
}

test("parses a Bash permission dialog", () => {
  const dialog = parseDialog(capture("capture-permission-bash.txt"));
  assert.ok(dialog);
  assert.equal(dialog.kind, "permission");
  assert.equal(dialog.prompt, "Do you want to proceed?");
  assert.equal(dialog.multiSelect, false);
  assert.deepEqual(
    dialog.options.map((option) => `${option.index} ${option.label}`),
    [
      "1 Yes",
      "2 Yes, and don’t ask again for: curl -sS https://example.com",
      "3 No",
    ],
  );
  assert.ok(dialog.context.includes("curl -sS https://example.com | head -3"));
});

test("parses a single-select AskUserQuestion dialog", () => {
  const dialog = parseDialog(capture("capture-question-single.txt"));
  assert.ok(dialog);
  assert.equal(dialog.kind, "question");
  assert.equal(dialog.prompt, "Do you prefer tabs or spaces for indentation?");
  assert.equal(dialog.multiSelect, false);
  assert.deepEqual(
    dialog.options.filter((option) => !option.meta).map((option) => option.label),
    ["Spaces", "Tabs"],
  );
  assert.deepEqual(
    dialog.options.filter((option) => option.meta).map((option) => option.label),
    ["Type something.", "Chat about this"],
  );
});

test("parses a multi-select dialog with its checkboxes", () => {
  const dialog = parseDialog(capture("capture-question-multi.txt"));
  assert.ok(dialog);
  assert.equal(dialog.multiSelect, true);
  assert.deepEqual(
    dialog.options.filter((option) => !option.meta).map((option) => `${option.index}:${option.label}`),
    ["1:Apple", "2:Pear", "3:Plum", "4:Fig"],
  );
  assert.ok(dialog.options.every((option) => !option.checked));
});

test("returns null when no dialog is on screen", () => {
  assert.equal(parseDialog(capture("capture-idle.txt")), null);
});

test("recognises an interactive Claude Code screen", () => {
  assert.equal(looksLikeClaudeSession(capture("capture-idle.txt")), true);
  assert.equal(looksLikeClaudeSession(["~/work main", "❯ ls -la"]), false);
});

test("answers a single-select dialog with its digit", () => {
  assert.deepEqual(answerKeys([2], false), ["2"]);
});

test("toggles then submits a multi-select dialog", () => {
  assert.deepEqual(answerKeys([1, 3], true), ["1", "3", ARROW_RIGHT, "1"]);
});

test("presses a meta option once instead of answering with it", () => {
  const dialog = parseDialog(capture("capture-question-multi.txt"));
  const typeSomething = dialog!.options.find((option) => option.meta)!;
  assert.deepEqual(metaOptionKeys(typeSomething.index), [String(typeSomething.index)]);
  assert.deepEqual(metaOptionKeys(0), []);
});

test("ignores option numbers the keyboard cannot reach", () => {
  assert.deepEqual(answerKeys([12], false), []);
});

test("reads the permission mode off the footer", () => {
  assert.equal(parsePermissionMode(capture("capture-idle.txt")), "auto");
  assert.equal(parsePermissionMode(["⏵⏵ accept edits on (shift+tab to cycle)"]), "acceptEdits");
  assert.equal(parsePermissionMode(["⏸ plan mode on (shift+tab to cycle)"]), "plan");
  assert.equal(parsePermissionMode(["WARNING: Claude Code running in Bypass Permissions mode"]), "bypassPermissions");
});

test("treats a footer with no mode as the default mode, and a foreign screen as unknown", () => {
  assert.equal(parsePermissionMode(["  ? for shortcuts", "  8k/200k tokens (4%)"]), "default");
  assert.equal(parsePermissionMode(["alice@host:~$ ls"]), null);
});

test("parses the model menu, whose footer scrolls off the screen", () => {
  const dialog = parseDialog(capture("capture-model-menu.txt"));
  assert.ok(dialog);
  assert.equal(dialog.kind, "question");
  assert.equal(dialog.prompt, "Select model");
  assert.deepEqual(
    dialog.options.map((option) => option.label),
    ["Default (recommended) ✔", "Opus (1M context)", "Fable"],
  );
  assert.match(dialog.options[0]!.description ?? "", /Opus 5 with 1M context/);
});

test("parses the thinking menu the CLI opens on Alt+T", () => {
  const dialog = parseDialog(capture("capture-thinking-menu.txt"));
  assert.ok(dialog);
  assert.equal(dialog.prompt, "Toggle thinking mode");
  assert.deepEqual(
    dialog.options.map((option) => option.label),
    ["Enabled ✔", "Disabled"],
  );
  assert.equal(dialog.options[1]!.description, "Claude will respond without extended thinking");
});
