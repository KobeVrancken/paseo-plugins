import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "./presence.shared.ts";
import { coerceApplicationId, coerceSettings, withProjectDetailLevel } from "./settings.shared.ts";

test("an empty file yields the defaults", () => {
  assert.deepEqual(coerceSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(coerceSettings({}), DEFAULT_SETTINGS);
});

test("keeps an application id the user cleared", () => {
  assert.equal(coerceSettings({ applicationId: null }).applicationId, null);
});

test("reads the settings out of the stored envelope", () => {
  const stored = { version: 1, settings: { enabled: false, defaultDetailLevel: "hidden" } };
  const settings = coerceSettings(stored);
  assert.equal(settings.enabled, false);
  assert.equal(settings.defaultDetailLevel, "hidden");
});

test("rejects a detail level it does not know", () => {
  assert.equal(coerceSettings({ defaultDetailLevel: "verbose" }).defaultDetailLevel, "detailed");
});

test("accepts a snowflake application id and trims it", () => {
  assert.equal(coerceApplicationId("  1234567890123456789 "), "1234567890123456789");
});

test("rejects anything that is not a snowflake", () => {
  assert.equal(coerceApplicationId("not-an-id"), null);
  assert.equal(coerceApplicationId("1234"), null);
  assert.equal(coerceApplicationId(1234567890123456789), null);
});

test("drops project entries with no path and de-duplicates the rest", () => {
  const settings = coerceSettings({
    projectDetailLevels: [
      { rootPath: "/work/client", displayName: "client", level: "hidden" },
      { rootPath: "/work/client", displayName: "client again", level: "detailed" },
      { displayName: "nowhere", level: "hidden" },
    ],
  });
  assert.deepEqual(settings.projectDetailLevels, [
    { rootPath: "/work/client", displayName: "client", level: "hidden" },
  ]);
});

test("drops a project entry whose level it cannot read rather than defaulting it", () => {
  const settings = coerceSettings({
    projectDetailLevels: [{ rootPath: "/work/client", displayName: "client", level: "verbose" }],
  });
  assert.deepEqual(settings.projectDetailLevels, []);
});

test("names a project after its path when it has no display name", () => {
  const settings = coerceSettings({
    projectDetailLevels: [{ rootPath: "/work/client", level: "hidden" }],
  });
  assert.equal(settings.projectDetailLevels[0]?.displayName, "/work/client");
});

test("setting a level and going back to the default round-trips", () => {
  const project = { rootPath: "/work/client", displayName: "client" };
  const hidden = withProjectDetailLevel(DEFAULT_SETTINGS, project, "hidden");
  assert.deepEqual(hidden.projectDetailLevels, [{ ...project, level: "hidden" }]);
  assert.deepEqual(withProjectDetailLevel(hidden, project, null).projectDetailLevels, []);
});

test("setting a level twice replaces it rather than stacking it", () => {
  const project = { rootPath: "/work/client", displayName: "client" };
  const once = withProjectDetailLevel(DEFAULT_SETTINGS, project, "hidden");
  const twice = withProjectDetailLevel(once, project, "projects");
  assert.deepEqual(twice.projectDetailLevels, [{ ...project, level: "projects" }]);
});

test("a project set to the level the default already has keeps its own entry", () => {
  const project = { rootPath: "/work/client", displayName: "client" };
  const settings = withProjectDetailLevel(DEFAULT_SETTINGS, project, "detailed");
  assert.equal(settings.projectDetailLevels.length, 1);
});
