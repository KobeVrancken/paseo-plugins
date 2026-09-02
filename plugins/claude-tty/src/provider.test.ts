import assert from "node:assert/strict";
import test from "node:test";
import { classifyProviderEntry, idleTimeoutOf, providerEntryFor } from "./provider.shared.ts";
import { DEFAULT_IDLE_TIMEOUT_MS, IDLE_TIMEOUT_ENV } from "./settings.shared.ts";

const expected = providerEntryFor("/opt/paseo-plugins");

test("builds the entry the adapter README documents", () => {
  assert.deepEqual(expected, {
    extends: "acp",
    label: "Claude TTY",
    command: ["/opt/paseo-plugins/apps/claude-tty-acp/bin/claude-tty-acp"],
    env: { [IDLE_TIMEOUT_ENV]: String(DEFAULT_IDLE_TIMEOUT_MS) },
    params: { supportsMcpServers: false },
  });
});

test("treats a missing entry as absent", () => {
  assert.equal(classifyProviderEntry(undefined, expected), "absent");
  assert.equal(classifyProviderEntry(null, expected), "absent");
});

test("matches this checkout regardless of the label", () => {
  assert.equal(classifyProviderEntry(expected, expected), "matching");
  assert.equal(classifyProviderEntry({ ...expected, label: "Claude" }, expected), "matching");
  assert.equal(
    classifyProviderEntry(
      { ...expected, command: ["/opt/paseo-plugins/apps/../apps/claude-tty-acp/bin/claude-tty-acp"] },
      expected,
    ),
    "matching",
  );
});

test("defaults old entries to one hour and reads configured timeouts", () => {
  const { env: _env, ...oldEntry } = expected;
  assert.equal(idleTimeoutOf(oldEntry), DEFAULT_IDLE_TIMEOUT_MS);
  assert.equal(classifyProviderEntry(oldEntry, expected), "matching");
  const custom = providerEntryFor("/opt/paseo-plugins", 7_200_000);
  assert.equal(idleTimeoutOf(custom), 7_200_000);
  assert.equal(classifyProviderEntry(custom, custom), "matching");
  assert.equal(idleTimeoutOf({ ...expected, env: { [IDLE_TIMEOUT_ENV]: "bad" } }), null);
});

test("reports this adapter pointed elsewhere or configured differently as mismatched", () => {
  assert.equal(
    classifyProviderEntry({ ...expected, command: ["/srv/other/apps/claude-tty-acp/bin/claude-tty-acp"] }, expected),
    "mismatched",
  );
  assert.equal(classifyProviderEntry({ ...expected, params: { supportsMcpServers: true } }, expected), "mismatched");
  assert.equal(classifyProviderEntry({ ...expected, params: undefined }, expected), "mismatched");
  assert.equal(classifyProviderEntry({ ...expected, extends: "claude" }, expected), "mismatched");
  assert.equal(classifyProviderEntry({ ...expected, env: { ...expected.env, EXTRA: "1" } }, expected), "mismatched");
});

test("leaves an entry it does not recognise alone", () => {
  assert.equal(classifyProviderEntry({ enabled: false }, expected), "foreign");
  assert.equal(classifyProviderEntry({ extends: "acp", command: ["/usr/bin/trae"] }, expected), "foreign");
  assert.equal(classifyProviderEntry({ extends: "acp", command: [] }, expected), "foreign");
  assert.equal(classifyProviderEntry("traecli", expected), "foreign");
});
