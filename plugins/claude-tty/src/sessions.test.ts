import assert from "node:assert/strict";
import test from "node:test";
import { isSafeStateFileStem, joinSessions, type StateFile } from "./sessions.shared.ts";

const ALIVE = 4242;
const DEAD = 9999;
const isAlive = (pid: number) => pid === ALIVE;

function session(id: string, lastActivity: number): StateFile {
  return {
    name: `${id}.json`,
    contents: JSON.stringify({
      version: 1,
      acpSessionId: id,
      claudeSessionId: `claude-${id}`,
      cwd: "/srv/project",
      model: "opus",
      mode: "default",
      lastActivity,
    }),
  };
}

function lock(id: string, pid: number): StateFile {
  return { name: `${id}.lock`, contents: JSON.stringify({ pid, token: "t", createdAt: 10 }) };
}

test("joins a session to its lock and reads the process liveness", () => {
  const [entry] = joinSessions([session("a", 5)], [lock("a", ALIVE)], isAlive);
  assert.equal(entry?.claudeSessionId, "claude-a");
  assert.equal(entry?.cwd, "/srv/project");
  assert.equal(entry?.model, "opus");
  assert.equal(entry?.mode, "default");
  assert.deepEqual(entry?.lock, { pid: ALIVE, createdAt: 10, live: true });
});

test("marks a lock whose process is gone as stale", () => {
  const [entry] = joinSessions([session("a", 5)], [lock("a", DEAD)], isAlive);
  assert.equal(entry?.lock?.live, false);
});

test("leaves a session without a lock unlocked", () => {
  const [entry] = joinSessions([session("a", 5)], [], isAlive);
  assert.equal(entry?.lock, null);
  assert.equal(entry?.corrupt, false);
});

test("lists a session file it cannot read as corrupt", () => {
  const unreadable = joinSessions([{ name: "a.json", contents: null }], [], isAlive);
  assert.equal(unreadable[0]?.corrupt, true);
  const truncated = joinSessions([{ name: "a.json", contents: '{"acpSessionId":"a"' }], [], isAlive);
  assert.equal(truncated[0]?.corrupt, true);
  const incomplete = joinSessions([{ name: "a.json", contents: '{"acpSessionId":"a"}' }], [], isAlive);
  assert.equal(incomplete[0]?.corrupt, true);
});

test("lists a lock with no session beside it", () => {
  const entries = joinSessions([], [lock("gone", DEAD)], isAlive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "gone");
  assert.equal(entries[0]?.orphanLock, true);
  assert.equal(entries[0]?.lock?.live, false);
});

test("treats an unreadable lock as stale rather than as a held session", () => {
  const [entry] = joinSessions([session("a", 5)], [{ name: "a.lock", contents: "junk" }], isAlive);
  assert.equal(entry?.lock?.live, false);
  assert.equal(entry?.lock?.pid, -1);
});

test("ignores files that are not sessions or locks", () => {
  assert.deepEqual(joinSessions([{ name: ".tmp", contents: "{}" }], [{ name: "notes.txt", contents: "" }], isAlive), []);
});

test("puts live sessions first and orders the rest by last activity", () => {
  const entries = joinSessions(
    [session("old", 1), session("recent", 9), session("held", 2)],
    [lock("held", ALIVE)],
    isAlive,
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["held", "recent", "old"],
  );
});

test("refuses a name that would leave the state directory", () => {
  assert.ok(isSafeStateFileStem("2f1c8e2a-0000-4000-8000-000000000000"));
  assert.ok(!isSafeStateFileStem("../config"));
  assert.ok(!isSafeStateFileStem("a/b"));
  assert.ok(!isSafeStateFileStem(".hidden"));
  assert.ok(!isSafeStateFileStem(""));
});
