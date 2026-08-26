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

function workspace(overrides: Partial<WorkspaceActivity> = {}): WorkspaceActivity {
  return {
    projectRootPath: "/home/dev/paseo-plugins",
    projectDisplayName: "paseo-plugins",
    workspaceName: "main",
    status: "done",
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
  assert.equal(renderActivity(snapshot(), DEFAULT_SETTINGS, START), null);
});

test("renders nothing while switched off", () => {
  assert.equal(renderActivity(snapshot(), settings({ enabled: false }), START), null);
});

test("names the project and the workspace", () => {
  const activity = renderActivity(snapshot(), settings(), START);
  assert.equal(activity?.details, "paseo-plugins — main");
});

test("drops a workspace name that only repeats the project", () => {
  const only = snapshot({ workspaces: [workspace({ workspaceName: "paseo-plugins" })] });
  assert.equal(renderActivity(only, settings(), START)?.details, "paseo-plugins");
});

test("takes the first workspace as active, the daemon having sorted them by activity", () => {
  const many = snapshot({
    workspaces: [
      workspace({ projectDisplayName: "newest", projectRootPath: "/a" }),
      workspace({ projectDisplayName: "older", projectRootPath: "/b" }),
    ],
  });
  assert.match(renderActivity(many, settings(), START)?.details ?? "", /^newest/);
});

test("counts every workspace, including muted ones", () => {
  const many = snapshot({ workspaces: [workspace({ projectRootPath: "/a" }), workspace({ projectRootPath: "/b" })] });
  assert.equal(renderActivity(many, settings(), START)?.state, "2 workspaces · idle");
});

test("reports running agents", () => {
  const busy = snapshot({ agents: { running: 2, needsAttention: 0 } });
  assert.equal(renderActivity(busy, settings(), START)?.state, "1 workspace · 2 agents running");
});

test("prefers waiting for input over work in flight", () => {
  const blocked = snapshot({ agents: { running: 1, needsAttention: 1 } });
  const activity = renderActivity(blocked, settings(), START);
  assert.equal(activity?.state, "1 workspace · 1 waiting for input");
  assert.equal(activity?.smallImageKey, "attention");
});

test("counts a workspace needing input even when no agent reports attention", () => {
  const blocked = snapshot({ workspaces: [workspace({ status: "needs_input" })] });
  assert.equal(renderActivity(blocked, settings(), START)?.state, "1 workspace · 1 waiting for input");
});

test("marks a running workspace with the running image", () => {
  const running = snapshot({ workspaces: [workspace({ status: "running" })] });
  assert.equal(renderActivity(running, settings(), START)?.smallImageKey, "running");
});

test("the projects level keeps the project name and drops the rest", () => {
  const activity = renderActivity(snapshot(), settings({ detailLevel: "projects" }), START);
  assert.equal(activity?.details, "paseo-plugins");
  assert.equal(activity?.state, "1 workspace");
});

test("the anonymous level names nothing at all", () => {
  const activity = renderActivity(snapshot(), settings({ detailLevel: "anonymous" }), START);
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
  assert.equal(renderActivity(many, muted, START)?.details, "paseo-plugins — main");
});

test("muting every open project redacts rather than going dark", () => {
  const muted = settings({
    mutedProjects: [{ rootPath: "/home/dev/paseo-plugins", displayName: "paseo-plugins" }],
  });
  assert.equal(renderActivity(snapshot(), muted, START)?.details, ANONYMOUS_DETAILS);
});

test("stays visible with no workspaces open", () => {
  const empty = snapshot({ workspaces: [] });
  assert.equal(renderActivity(empty, settings(), START)?.details, ANONYMOUS_DETAILS);
});

test("counts elapsed time from the moment the plugin started", () => {
  assert.equal(renderActivity(snapshot(), settings(), START)?.startTimestamp, START);
});
