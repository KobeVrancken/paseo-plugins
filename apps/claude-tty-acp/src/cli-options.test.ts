import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArgs } from "./cli-options.ts";

test("serves ACP when no CLI flags are passed", () => {
  assert.deepEqual(parseCliArgs([]), { kind: "serve" });
});

test("prints help and version without starting ACP", () => {
  const help = parseCliArgs(["--help"]);
  assert.equal(help.kind, "print");
  assert.match(help.text, /Usage:/);
  assert.deepEqual(parseCliArgs(["--version"]), { kind: "print", text: "0.1.0" });
});

test("rejects unknown flags", () => {
  assert.throws(() => parseCliArgs(["--wat"]), /Unknown arguments/);
});
