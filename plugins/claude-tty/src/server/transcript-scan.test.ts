import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { newScan, readNewLines } from "./transcript-scan.server.ts";

test("reads only what has been appended since the last read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "transcript-scan-"));
  const file = path.join(root, "session.jsonl");
  const scan = newScan();

  await writeFile(file, '{"one":1}\n{"two":2}\n');
  assert.deepEqual(await readNewLines(file, scan), { text: '{"one":1}\n{"two":2}', rewritten: false });

  assert.deepEqual(await readNewLines(file, scan), { text: "", rewritten: false });

  await writeFile(file, '{"one":1}\n{"two":2}\n{"three":3}\n');
  assert.deepEqual(await readNewLines(file, scan), { text: '{"three":3}', rewritten: false });
});

test("holds a half-written line back until the read that finds the rest of it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "transcript-scan-"));
  const file = path.join(root, "session.jsonl");
  const scan = newScan();

  await writeFile(file, '{"one":1}\n{"tw');
  assert.deepEqual(await readNewLines(file, scan), { text: '{"one":1}', rewritten: false });

  await writeFile(file, '{"one":1}\n{"two":2}\n');
  assert.deepEqual(await readNewLines(file, scan), { text: '{"two":2}', rewritten: false });
});

test("counts bytes rather than characters, so a multi-byte record is not read twice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "transcript-scan-"));
  const file = path.join(root, "session.jsonl");
  const scan = newScan();

  await writeFile(file, '{"said":"↳ nested"}\n');
  assert.deepEqual(await readNewLines(file, scan), { text: '{"said":"↳ nested"}', rewritten: false });
  assert.deepEqual(await readNewLines(file, scan), { text: "", rewritten: false });
});

test("notices a rewrite that did not shrink the file, which is what a compaction looks like", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "transcript-scan-"));
  const file = path.join(root, "session.jsonl");
  const scan = newScan();

  await writeFile(file, '{"session":"first","record":1}\n{"session":"first","record":2}\n');
  assert.equal((await readNewLines(file, scan)).rewritten, false);

  // A compaction replaces the file with a summary and the turns after it, at whatever size that is.
  await writeFile(file, '{"session":"after","record":1}\n{"session":"after","record":2}\n{"session":"after","record":3}\n');
  const read = await readNewLines(file, scan);
  assert.equal(read.rewritten, true);
  assert.equal(read.text.split("\n").length, 3);

  // And one that shrank it, which is the case a length comparison would have caught on its own.
  await writeFile(file, '{"session":"third"}\n');
  assert.deepEqual(await readNewLines(file, scan), { text: '{"session":"third"}', rewritten: true });
});
