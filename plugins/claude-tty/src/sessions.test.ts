import assert from "node:assert/strict";
import test from "node:test";
import { adapterBinaryPath, adapterEntryPath } from "./paths.shared.ts";
import {
  attachAgents,
  isAdapterCommand,
  isSafeStateFileStem,
  joinSessions,
  lastActiveLabel,
  ownsLock,
  type ProcessIdentity,
  type SessionLock,
  type StateFile,
} from "./sessions.shared.ts";

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

test("names a session after the Paseo agent holding it", () => {
  const entries = joinSessions([session("a", 5)], [], isAlive);
  const [entry] = attachAgents(entries, [
    { agent: { id: "agent-a", title: "Fix the pipeline", runtimeInfo: { sessionId: "a" } } },
  ]);
  assert.deepEqual(entry?.agent, { id: "agent-a", title: "Fix the pipeline" });
});

test("reads an agent the SDK hands over without the daemon's wrapper", () => {
  const entries = joinSessions([session("a", 5)], [], isAlive);
  const [entry] = attachAgents(entries, [{ id: "agent-a", title: null, persistence: { sessionId: "a" } }]);
  assert.deepEqual(entry?.agent, { id: "agent-a", title: null });
});

test("leaves a session Paseo no longer lists an agent for alone", () => {
  const entries = joinSessions([session("a", 5)], [], isAlive);
  assert.equal(attachAgents(entries, [])[0]?.agent, null);
  assert.equal(attachAgents(entries, [{ agent: { id: "agent-b", runtimeInfo: { sessionId: "b" } } }])[0]?.agent, null);
  assert.equal(attachAgents(entries, [null, 7, { agent: {} }])[0]?.agent, null);
});

test("recognises the command the adapter is actually launched with", () => {
  // The bin wrapper execs the entry through a relative path, which is what shows up in /proc.
  assert.ok(isAdapterCommand("node /home/me/paseo-plugins/apps/claude-tty-acp/bin/../dist/cli.js"));
  assert.ok(isAdapterCommand("node /home/me/paseo-plugins/apps/claude-tty-acp/dist/cli.js --verbose"));
  // Tied to the paths the plugin itself would register, so a rename cannot quietly disarm the guard.
  assert.ok(adapterBinaryPath("/srv/checkout").includes("claude-tty-acp"));
  assert.ok(isAdapterCommand(`node ${adapterEntryPath("/srv/checkout")}`));
});

test("does not mistake Claude itself for the adapter", () => {
  // A native Claude carries the adapter's name only in the settings path it is handed.
  assert.ok(!isAdapterCommand("claude --session-id a --settings /tmp/claude-tty-acp-OQkDy5/settings.json"));
  // Installed as a bundle, Claude is itself `node <...>/cli.js` — both halves of the old substring test.
  assert.ok(
    !isAdapterCommand(
      "node /home/me/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js --settings /tmp/claude-tty-acp-OQkDy5/settings.json",
    ),
  );
  assert.ok(!isAdapterCommand("node /home/me/other/dist/cli.js"));
  assert.ok(!isAdapterCommand(""));
});

const LOCK: SessionLock = { pid: 4242, createdAt: 10_000, live: true };
function identity(overrides: Partial<ProcessIdentity> = {}): ProcessIdentity {
  return { command: "node /srv/apps/claude-tty-acp/dist/cli.js", startedAt: 9_000, zombie: false, ...overrides };
}

test("accepts only the process that can have written the lock", () => {
  assert.ok(ownsLock(identity(), LOCK));
  // Started within the slack that a truncated or drifting clock reading costs.
  assert.ok(ownsLock(identity({ startedAt: 12_000 }), LOCK));
});

test("refuses a process that cannot be the lock's owner", () => {
  // A second adapter that inherited the PID: same command, but it started long after the lock.
  assert.ok(!ownsLock(identity({ startedAt: 900_000 }), LOCK));
  // A bystander whose arguments merely name the adapter's own entry file.
  assert.ok(!ownsLock(identity({ command: "tail -f /srv/apps/claude-tty-acp/dist/cli.js", startedAt: 900_000 }), LOCK));
  assert.ok(!ownsLock(identity({ zombie: true }), LOCK));
  assert.ok(!ownsLock(identity({ startedAt: null }), LOCK));
  assert.ok(!ownsLock(identity({ command: "claude --session-id a" }), LOCK));
});

test("says how long a session has been left alone", () => {
  const now = 1_000 * 60 * 60 * 24 * 400;
  assert.equal(lastActiveLabel(now - 30_000, now), "last prompted just now");
  assert.equal(lastActiveLabel(now - 60_000, now), "last prompted 1 minute ago");
  assert.equal(lastActiveLabel(now - 59 * 60_000, now), "last prompted 59 minutes ago");
  assert.equal(lastActiveLabel(now - 90 * 60_000, now), "last prompted 1 hour ago");
  assert.equal(lastActiveLabel(now - 25 * 60 * 60_000, now), "last prompted 1 day ago");
  assert.equal(lastActiveLabel(now - 40 * 24 * 60 * 60_000, now), "last prompted 40 days ago");
});

test("says nothing about a session with no recorded activity, and reads a clock that moved as now", () => {
  assert.equal(lastActiveLabel(null, 1_000), null);
  assert.equal(lastActiveLabel(Number.NaN, 1_000), null);
  assert.equal(lastActiveLabel(2_000, 1_000), "last prompted just now");
});
