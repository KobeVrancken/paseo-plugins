import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANONYMOUS_DETAILS,
  DEFAULT_SETTINGS,
  renderActivity,
  type PresenceSettings,
  type PresenceSnapshot,
  type WorkspaceActivity,
} from "./presence.shared.ts";

const START = 1_700_000_000_000;
const NOW = START + 60_000;

function workspace(overrides: Partial<WorkspaceActivity> = {}): WorkspaceActivity {
  return {
    projectRootPath: "/home/dev/paseo-plugins",
    projectDisplayName: "paseo-plugins",
    workspaceName: "main",
    status: "done",
    activityAt: null,
    statusEnteredAt: START,
    ...overrides,
  };
}

function snapshot(overrides: Partial<PresenceSnapshot> = {}): PresenceSnapshot {
  return {
    workspaces: [workspace()],
    agents: { running: 0, needsAttention: 0 },
    ...overrides,
  };
}

function settings(overrides: Partial<PresenceSettings> = {}): PresenceSettings {
  return { ...DEFAULT_SETTINGS, applicationId: "1234", ...overrides };
}

test("renders nothing until an application id is configured", () => {
  assert.equal(renderActivity(snapshot(), DEFAULT_SETTINGS, START, NOW), null);
});

test("renders nothing while switched off", () => {
  assert.equal(renderActivity(snapshot(), settings({ enabled: false }), START, NOW), null);
});

test("names the project and the workspace", () => {
  const activity = renderActivity(snapshot(), settings(), START, NOW);
  assert.equal(activity?.details, "paseo-plugins — main");
});

test("drops a workspace name that only repeats the project", () => {
  const only = snapshot({ workspaces: [workspace({ workspaceName: "paseo-plugins" })] });
  assert.equal(renderActivity(only, settings(), START, NOW)?.details, "paseo-plugins");
});

test("takes the most recently active workspace, whatever order the daemon returned", () => {
  const many = snapshot({
    workspaces: [
      workspace({ projectDisplayName: "older", projectRootPath: "/b", statusEnteredAt: START - 60_000 }),
      workspace({ projectDisplayName: "newest", projectRootPath: "/a", statusEnteredAt: START }),
    ],
  });
  assert.match(renderActivity(many, settings(), START, NOW)?.details ?? "", /^newest/);
});

test("prefers the daemon's activity stamp over the status stamp", () => {
  const many = snapshot({
    workspaces: [
      workspace({ projectDisplayName: "stale", projectRootPath: "/b", statusEnteredAt: START }),
      workspace({ projectDisplayName: "touched", projectRootPath: "/a", statusEnteredAt: START - 60_000, activityAt: START + 1 }),
    ],
  });
  assert.match(renderActivity(many, settings(), START, NOW)?.details ?? "", /^touched/);
});

test("a workspace still running outranks one that merely finished more recently", () => {
  const many = snapshot({
    workspaces: [
      workspace({ projectDisplayName: "just-finished", projectRootPath: "/b", statusEnteredAt: NOW - 1 }),
      workspace({ projectDisplayName: "still-running", projectRootPath: "/a", status: "running", statusEnteredAt: START - 3_600_000 }),
    ],
  });
  assert.match(renderActivity(many, settings(), START, NOW)?.details ?? "", /^still-running/);
});

test("counts every workspace, including muted ones", () => {
  const many = snapshot({ workspaces: [workspace({ projectRootPath: "/a" }), workspace({ projectRootPath: "/b" })] });
  assert.equal(renderActivity(many, settings(), START, NOW)?.state, "2 workspaces · idle");
});

test("reports running agents", () => {
  const busy = snapshot({ agents: { running: 2, needsAttention: 0 } });
  assert.equal(renderActivity(busy, settings(), START, NOW)?.state, "1 workspace · 2 agents running");
});

test("prefers waiting for input over work in flight", () => {
  const blocked = snapshot({ agents: { running: 1, needsAttention: 1 } });
  const activity = renderActivity(blocked, settings(), START, NOW);
  assert.equal(activity?.state, "1 workspace · 1 waiting for input");
  assert.equal(activity?.smallImageKey, "attention");
});

test("counts a workspace needing input even when no agent reports attention", () => {
  const blocked = snapshot({ workspaces: [workspace({ status: "needs_input" })] });
  assert.equal(renderActivity(blocked, settings(), START, NOW)?.state, "1 workspace · 1 waiting for input");
});

test("marks a running workspace with the running image", () => {
  const running = snapshot({ workspaces: [workspace({ status: "running" })] });
  assert.equal(renderActivity(running, settings(), START, NOW)?.smallImageKey, "running");
});

test("the projects level keeps the project name and drops the rest", () => {
  const activity = renderActivity(snapshot(), settings({ detailLevel: "projects" }), START, NOW);
  assert.equal(activity?.details, "paseo-plugins");
  assert.equal(activity?.state, "1 workspace");
});

test("the anonymous level names nothing at all", () => {
  const activity = renderActivity(snapshot(), settings({ detailLevel: "anonymous" }), START, NOW);
  assert.deepEqual(activity, {
    details: ANONYMOUS_DETAILS,
    largeImageKey: "paseo",
    largeImageText: "Paseo",
    startTimestamp: START,
  });
});

test("a muted project falls through to the next unmuted workspace", () => {
  const many = snapshot({
    workspaces: [
      workspace({ projectRootPath: "/work/client", projectDisplayName: "client-work" }),
      workspace({ projectRootPath: "/home/dev/paseo-plugins" }),
    ],
  });
  const muted = settings({ mutedProjects: [{ rootPath: "/work/client", displayName: "client-work" }] });
  assert.equal(renderActivity(many, muted, START, NOW)?.details, "paseo-plugins — main");
});

test("muting every open project redacts rather than going dark", () => {
  const muted = settings({
    mutedProjects: [{ rootPath: "/home/dev/paseo-plugins", displayName: "paseo-plugins" }],
  });
  assert.equal(renderActivity(snapshot(), muted, START, NOW)?.details, ANONYMOUS_DETAILS);
});

test("stays visible with no workspaces open", () => {
  const empty = snapshot({ workspaces: [] });
  assert.equal(renderActivity(empty, settings(), START, NOW)?.details, ANONYMOUS_DETAILS);
});

test("counts elapsed time from the moment the plugin started", () => {
  assert.equal(renderActivity(snapshot(), settings(), START, NOW)?.startTimestamp, START);
});
