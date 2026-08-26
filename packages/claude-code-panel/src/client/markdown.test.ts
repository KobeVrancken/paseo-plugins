import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "./markdown.client.ts";

test("parses headings and paragraphs", () => {
  assert.deepEqual(parseMarkdown("# Title\n\nSome text"), [
    { kind: "heading", level: 1, inline: [{ kind: "text", text: "Title" }] },
    { kind: "paragraph", inline: [{ kind: "text", text: "Some text" }] },
  ]);
});

test("keeps fenced code verbatim", () => {
  const blocks = parseMarkdown("```ts\nconst a = `x`;\n**not bold**\n```");
  assert.deepEqual(blocks, [{ kind: "code", text: "const a = `x`;\n**not bold**", language: "ts" }]);
});

test("parses emphasis, code spans and links", () => {
  assert.deepEqual(parseInline("a **b** and `c` and [d](https://e.f)"), [
    { kind: "text", text: "a " },
    { kind: "text", text: "b", bold: true },
    { kind: "text", text: " and " },
    { kind: "text", text: "c", code: true },
    { kind: "text", text: " and " },
    { kind: "link", text: "d", href: "https://e.f" },
  ]);
});

test("does not treat emphasis inside a code span", () => {
  assert.deepEqual(parseInline("`**x**`"), [{ kind: "text", text: "**x**", code: true }]);
});

test("tracks nesting depth in lists", () => {
  const blocks = parseMarkdown("- one\n  - two\n- three");
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0]!.kind === "list");
  assert.deepEqual(
    blocks[0]!.items.map((item) => `${item.depth}:${item.marker}`),
    ["0:•", "1:•", "0:•"],
  );
});

test("keeps ordered list markers", () => {
  const blocks = parseMarkdown("1. first\n2. second");
  assert.ok(blocks[0]!.kind === "list" && blocks[0]!.ordered);
  assert.deepEqual(blocks[0]!.items.map((item) => item.marker), ["1.", "2."]);
});

test("parses block quotes recursively", () => {
  const blocks = parseMarkdown("> quoted **text**");
  assert.ok(blocks[0]!.kind === "quote");
  assert.deepEqual(blocks[0]!.blocks, [
    { kind: "paragraph", inline: [{ kind: "text", text: "quoted " }, { kind: "text", text: "text", bold: true }] },
  ]);
});

test("collects table rows and drops the divider", () => {
  const blocks = parseMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.deepEqual(blocks, [{ kind: "table", rows: [["a", "b"], ["1", "2"]] }]);
});

test("parses horizontal rules", () => {
  assert.deepEqual(parseMarkdown("---"), [{ kind: "rule" }]);
});

test("leaves plain text untouched", () => {
  assert.deepEqual(parseInline("no markup here"), [{ kind: "text", text: "no markup here" }]);
});
