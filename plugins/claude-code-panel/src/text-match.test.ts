import assert from "node:assert/strict";
import { test } from "node:test";
import { compareMatchScores, scoreFields, scoreMatch } from "./text-match.shared.ts";

function tierOf(query: string, text: string): number | null {
  return scoreMatch(query, text)?.tier ?? null;
}

test("ranks an exact hit above a prefix, a word start and a subsequence", () => {
  assert.equal(tierOf("panel", "panel"), 0);
  assert.equal(tierOf("panel", "panel-controls"), 1);
  assert.equal(tierOf("pane", "panelcontrols"), 2);
  assert.equal(tierOf("controls", "panel-controls"), 1);
  assert.equal(tierOf("ntrol", "panelcontrols"), 4);
  assert.equal(tierOf("pnl", "panel"), 5);
  assert.equal(tierOf("zz", "panel"), null);
});

test("matches regardless of case, and matches everything on a blank query", () => {
  assert.equal(tierOf("PANEL", "panel"), 0);
  assert.equal(tierOf("", "anything"), 0);
});

test("needs every word of the query, but not all in one field", () => {
  assert.ok(scoreFields("git commit", ["git-commit", "Write a commit message"]));
  assert.ok(scoreFields("commit message", ["git-commit", "Write a commit message"]));
  assert.equal(scoreFields("deploy", ["git-commit", "Write a commit message"]), null);
});

test("sorts better scores first", () => {
  const better = scoreMatch("pan", "panel")!;
  const worse = scoreMatch("pan", "the panel")!;
  assert.ok(compareMatchScores(better, worse) < 0);
});
