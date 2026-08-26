import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "./presence.shared.ts";
import { coerceApplicationId, coerceSettings, withMutedProject } from "./settings.shared.ts";

test("an empty file yields the defaults", () => {
  assert.deepEqual(coerceSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(coerceSettings({}), DEFAULT_SETTINGS);
});

test("reads the settings out of the stored envelope", () => {
  const stored = { version: 1, settings: { enabled: false, detailLevel: "anonymous" } };
  const settings = coerceSettings(stored);
  assert.equal(settings.enabled, false);
  assert.equal(settings.detailLevel, "anonymous");
});

test("rejects a detail level it does not know", () => {
  assert.equal(coerceSettings({ detailLevel: "verbose" }).detailLevel, "detailed");
});

test("accepts a snowflake application id and trims it", () => {
  assert.equal(coerceApplicationId("  1234567890123456789 "), "1234567890123456789");
});

test("rejects anything that is not a snowflake", () => {
  assert.equal(coerceApplicationId("not-an-id"), null);
  assert.equal(coerceApplicationId("1234"), null);
  assert.equal(coerceApplicationId(1234567890123456789), null);
});

test("drops muted entries with no path and de-duplicates the rest", () => {
  const settings = coerceSettings({
    mutedProjects: [
      { rootPath: "/work/client", displayName: "client" },
      { rootPath: "/work/client", displayName: "client again" },
      { displayName: "nowhere" },
    ],
  });
  assert.deepEqual(settings.mutedProjects, [{ rootPath: "/work/client", displayName: "client" }]);
});

test("names a muted project after its path when it has no display name", () => {
  const settings = coerceSettings({ mutedProjects: [{ rootPath: "/work/client" }] });
  assert.equal(settings.mutedProjects[0]?.displayName, "/work/client");
});

test("muting and unmuting a project round-trips", () => {
  const project = { rootPath: "/work/client", displayName: "client" };
  const muted = withMutedProject(DEFAULT_SETTINGS, project, true);
  assert.deepEqual(muted.mutedProjects, [project]);
  assert.deepEqual(withMutedProject(muted, project, false).mutedProjects, []);
});

test("muting a project twice does not stack it", () => {
  const project = { rootPath: "/work/client", displayName: "client" };
  const once = withMutedProject(DEFAULT_SETTINGS, project, true);
  assert.equal(withMutedProject(once, project, true).mutedProjects.length, 1);
});
