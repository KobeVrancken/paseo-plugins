import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { capEntryForList, parseQuestionAnswers, TimelineBuilder } from "../render-map.server.ts";
import type { RenderBody, RenderEntry } from "../render-types.shared.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function buildFixture(name: string): TimelineBuilder {
  const builder = new TimelineBuilder();
  const raw = readFileSync(path.join(fixturesDir, name), "utf8");
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    builder.push(JSON.parse(line));
  }
  return builder;
}

function bodies(builder: TimelineBuilder): RenderBody[] {
  return builder.changedSince(0).map((entry: RenderEntry) => entry.body);
}

function findBody<Kind extends RenderBody["kind"]>(
  builder: TimelineBuilder,
  kind: Kind,
): Extract<RenderBody, { kind: Kind }> {
  const found = bodies(builder).find((body) => body.kind === kind);
  assert.ok(found, `expected a ${kind} entry`);
  return found as Extract<RenderBody, { kind: Kind }>;
}

test("renders a user prompt without its system reminders", () => {
  const builder = buildFixture("session-basic.jsonl");
  const user = findBody(builder, "user_text");
  assert.equal(user.text, "Fix the parser");
  assert.equal(builder.firstUserPrompt, "Fix the parser");
});

test("picks up the session title", () => {
  assert.equal(buildFixture("session-basic.jsonl").title, "Fixing the parser");
});

test("merges consecutive assistant text blocks sharing a request id", () => {
  const builder = buildFixture("session-basic.jsonl");
  const markdown = bodies(builder).filter((body) => body.kind === "assistant_markdown");
  assert.equal(markdown.length, 1);
  assert.equal(markdown[0]!.text, "I'll read it first.\n\nThen patch it.");
  assert.equal(markdown[0]!.model, "claude-opus-5");
});

test("keeps thinking blocks as their own entry", () => {
  assert.equal(findBody(buildFixture("session-basic.jsonl"), "thinking").text, "Let me look at the file.");
});

test("pairs a tool result back onto its tool call", () => {
  const builder = buildFixture("session-basic.jsonl");
  const bash = bodies(builder).find((body) => body.kind === "tool_call" && body.toolName === "Bash");
  assert.ok(bash && bash.kind === "tool_call");
  assert.equal(bash.tool, "bash");
  assert.equal(bash.summary, "List files");
  assert.equal(bash.status, "ok");
  assert.match(bash.result?.text ?? "", /parser\.ts/);
});

test("marks a failed tool result as an error", () => {
  const builder = buildFixture("session-basic.jsonl");
  const edit = bodies(builder).find((body) => body.kind === "tool_call" && body.toolName === "Edit");
  assert.ok(edit && edit.kind === "tool_call");
  assert.equal(edit.status, "error");
  assert.equal(edit.summary, "parser.ts");
  const diff = edit.detail.find((block) => block.kind === "diff");
  assert.ok(diff && diff.kind === "diff");
  assert.deepEqual(
    diff.lines.map((line) => `${line.kind} ${line.text}`),
    ["ctx const a = 1;", "del const b = 2;", "add const b = 3;"],
  );
});

test("renders TodoWrite as a checklist", () => {
  const todos = findBody(buildFixture("session-basic.jsonl"), "todo_list").todos;
  assert.equal(todos.length, 2);
  assert.equal(todos[0]!.status, "completed");
  assert.equal(todos[1]!.status, "in_progress");
});

test("renders AskUserQuestion and resolves it from the tool result", () => {
  const question = findBody(buildFixture("session-basic.jsonl"), "question");
  assert.equal(question.questions[0]!.question, "Which parser should we keep?");
  assert.equal(question.questions[0]!.options.length, 2);
  assert.deepEqual(question.answers, ["Keep both"]);
});

test("ignores injected task notifications when picking the first prompt", () => {
  const builder = new TimelineBuilder();
  builder.push({
    type: "user",
    uuid: "u1",
    message: { role: "user", content: "<task-notification>agent finished</task-notification>" },
  });
  assert.equal(builder.firstUserPrompt, null);
  assert.equal(builder.total, 0);
});

test("extracts the chosen answers from a question result", () => {
  assert.deepEqual(
    parseQuestionAnswers(
      'Your questions have been answered: "Do you prefer tabs or spaces?"="Tabs". You can now continue with these answers in mind.',
    ),
    ["Tabs"],
  );
  assert.deepEqual(parseQuestionAnswers("no pairs here"), ["no pairs here"]);
});

test("renders a slash command as an activity row", () => {
  const activities = bodies(buildFixture("session-basic.jsonl")).filter((body) => body.kind === "activity");
  assert.ok(activities.some((body) => body.kind === "activity" && body.label === "ran /model opus"));
});

test("drops empty local command output", () => {
  const activities = bodies(buildFixture("session-basic.jsonl")).filter((body) => body.kind === "activity");
  assert.ok(!activities.some((body) => body.kind === "activity" && body.label.includes("local-command")));
});

test("passes transcript images through as data URIs", () => {
  const image = findBody(buildFixture("session-basic.jsonl"), "image");
  assert.equal(image.dataUri, "data:image/png;base64,iVBORw0KGgo=");
});

test("counts unsupported entries and ignores bookkeeping ones", () => {
  // one `attachment` plus one unknown type; `mode` is bookkeeping and stays uncounted.
  assert.equal(buildFixture("session-basic.jsonl").unsupportedCount, 2);
});

test("reports only entries changed since a revision", () => {
  const builder = new TimelineBuilder();
  builder.push({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } });
  const revision = builder.revision;
  builder.push({
    type: "assistant",
    uuid: "a1",
    message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
  });
  const changed = builder.changedSince(revision);
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.body.kind, "assistant_markdown");
});

test("re-emits a tool call when its result lands later", () => {
  const builder = new TimelineBuilder();
  builder.push({
    type: "assistant",
    uuid: "a1",
    message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b.ts" } }] },
  });
  const revision = builder.revision;
  builder.push({
    type: "user",
    uuid: "u1",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] },
  });
  const changed = builder.changedSince(revision);
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.index, 0);
  assert.equal(changed[0]!.body.kind === "tool_call" && changed[0]!.body.status, "ok");
});

test("keeps an unknown tool on a generic card", () => {
  const builder = new TimelineBuilder();
  builder.push({
    type: "assistant",
    uuid: "a1",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "mcp__context7__query-docs", input: { query: "zod" } }],
    },
  });
  const tool = findBody(builder, "tool_call");
  assert.equal(tool.tool, "generic");
  assert.equal(tool.title, "mcp__context7__query-docs");
  assert.equal(tool.summary, "query: zod");
});

test("finds the newest unanswered question", () => {
  const builder = buildFixture("session-basic.jsonl");
  assert.equal(builder.pendingQuestionIndex(), null);
});

test("shortens long tool detail for the list payload", () => {
  const builder = new TimelineBuilder();
  builder.push({
    type: "assistant",
    uuid: "a1",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "/a.ts", content: "x".repeat(5000) } }],
    },
  });
  const full = builder.entryAt(0)!;
  const capped = capEntryForList(full);
  assert.equal(full.body.kind === "tool_call" && full.body.detailTruncated, false);
  assert.ok(capped.body.kind === "tool_call" && capped.body.detailTruncated);
  const block = capped.body.kind === "tool_call" ? capped.body.detail[0] : null;
  assert.ok(block && block.kind === "code" && block.text.length < 1000);
});

test("leaves a small tool call alone", () => {
  const builder = new TimelineBuilder();
  builder.push({
    type: "assistant",
    uuid: "a1",
    message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
  });
  const full = builder.entryAt(0)!;
  assert.equal(capEntryForList(full), full);
});

test("defers a large image out of the list payload", () => {
  const builder = new TimelineBuilder();
  builder.push({
    type: "user",
    uuid: "u1",
    message: {
      role: "user",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(200_000) } }],
    },
  });
  const full = builder.entryAt(0)!;
  const capped = capEntryForList(full);
  assert.ok(full.body.kind === "image" && full.body.dataUri !== null);
  assert.ok(capped.body.kind === "image" && capped.body.dataUri === null && capped.body.deferred);
});
