import assert from "node:assert/strict";
import { test } from "node:test";
import { listArgs, parseForgeItems, sortForgeItems, warningFor } from "./github.server.ts";

test("asks gh for a page of issues, and narrows it with a search", () => {
  assert.deepEqual(listArgs("issue", "  ", 20), [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "20",
    "--json",
    "number,title,state,url",
  ]);
  assert.deepEqual(listArgs("pr", " login ", 5).slice(0, 2), ["pr", "list"]);
  assert.deepEqual(listArgs("pr", " login ", 5).slice(-2), ["--search", "login"]);
});

test("reads the rows gh prints, and skips anything unrecognizable", () => {
  const stdout = JSON.stringify([
    { number: 7, title: "Crash on paste", state: "OPEN", url: "https://example.test/7" },
    { title: "no number" },
  ]);
  assert.deepEqual(parseForgeItems(stdout, "issue"), [
    { kind: "issue", number: 7, title: "Crash on paste", state: "open", url: "https://example.test/7" },
  ]);
  assert.deepEqual(parseForgeItems("not json", "pr"), []);
});

test("puts the newest issue or pull request first", () => {
  const item = (number: number) => ({ kind: "pr" as const, number, title: "", state: "", url: "" });
  assert.deepEqual(
    sortForgeItems([item(2), item(9), item(4)]).map((entry) => entry.number),
    [9, 4, 2],
  );
});

test("repeats what gh said about the failure", () => {
  assert.match(warningFor(new Error("spawn gh ENOENT")), /not installed/);
  assert.equal(
    warningFor(new Error("Command failed: gh issue list\ngh: Not a git repository")),
    "gh: Not a git repository",
  );
});
