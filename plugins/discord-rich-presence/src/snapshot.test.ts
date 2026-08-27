import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { renderActivity, DEFAULT_SETTINGS } from "./presence.shared.ts";
import { toAgentActivities, toPresenceSnapshot, toWorkspaceActivity } from "./snapshot.shared.ts";

function fixture(name: string): unknown[] {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
}

const workspaceEntries = fixture("workspaces");
const agentEntries = fixture("agents");

test("reads the fields the presence needs off a live workspace payload", () => {
  const workspace = toWorkspaceActivity(workspaceEntries[0]);
  assert.deepEqual(workspace, {
    id: "wks_8862cf1b6651af1a",
    projectRootPath: "/home/dev/todo-app",
    projectDisplayName: "todo-app",
    workspaceName: "Build POC",
    status: "done",
    activityAt: null,
    statusEnteredAt: Date.parse("2026-08-25T21:15:41.299Z"),
  });
});

test("skips a payload without a project root", () => {
  assert.equal(toWorkspaceActivity({ name: "orphan" }), null);
  assert.equal(toWorkspaceActivity(null), null);
});

test("falls back to the root path when a project has no display name", () => {
  const workspace = toWorkspaceActivity({ projectRootPath: "/home/dev/thing" });
  assert.equal(workspace?.projectDisplayName, "/home/dev/thing");
});

test("keeps the workspace that places an agent in a project", () => {
  const agents = toAgentActivities(agentEntries);
  assert.deepEqual(
    agents.filter((agent) => agent.running),
    [{ workspaceId: "wks_dfd1cd899bcb5185", running: true, needsAttention: false }],
  );
});

test("reads an agent waiting on the user", () => {
  const waiting = [{ agent: { status: "idle", requiresAttention: true, workspaceId: "wks_a" } }];
  assert.deepEqual(toAgentActivities(waiting), [
    { workspaceId: "wks_a", running: false, needsAttention: true },
  ]);
});

test("ignores archived and closed agents", () => {
  const gone = [
    { agent: { status: "running", archivedAt: "2026-08-01T00:00:00.000Z" } },
    { agent: { status: "closed", requiresAttention: true } },
  ];
  assert.deepEqual(toAgentActivities(gone), []);
});

test("builds a presence from the live payloads", () => {
  const snapshot = toPresenceSnapshot(workspaceEntries, agentEntries);
  const now = Date.parse("2026-08-26T11:10:00.000Z");
  const activity = renderActivity(
    snapshot,
    { ...DEFAULT_SETTINGS, applicationId: "1234567890123456789" },
    now - 60_000,
    now,
  );
  assert.equal(activity?.details, "acme-billing — Invoke mattpocock-skills:wayfinder");
  // Each of the three workspaces is its own project, and the running agent belongs to none of them.
  assert.equal(activity?.state, "1 workspace · idle");
  assert.equal(activity?.smallImageKey, "idle");
});
