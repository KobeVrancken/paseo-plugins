import assert from "node:assert/strict";
import test from "node:test";
import { sendWatchingFrame, watchingFrame, type Frame } from "./presence.server.ts";

const now = Date.UTC(2026, 0, 1, 12, 0, 0);

test("claims the bound terminal, with activity dated back inside the presence window", () => {
  const frame = watchingFrame("terminal-1", now);
  assert.equal(frame.isBinary, false);
  const parsed = JSON.parse(frame.data) as { type: string; message: Record<string, unknown> };
  assert.equal(parsed.type, "session");
  assert.deepEqual(parsed.message, {
    type: "client_heartbeat",
    deviceType: "web",
    focusedAgentId: null,
    focusedTerminalId: "terminal-1",
    appVisible: true,
    lastActivityAt: new Date(now - 150_000).toISOString(),
  });
  const age = now - Date.parse(parsed.message.lastActivityAt as string);
  assert.ok(age < 180_000, "still counts as present");
  assert.ok(age > 60_000, "older than any session the user is really using");
});

test("reports whether the frame reached the daemon", async () => {
  const sent: Frame[] = [];
  const delivered = await sendWatchingFrame(
    "terminal-1",
    (frame, done) => {
      sent.push(frame);
      done(null);
    },
    now,
  );
  assert.equal(delivered, true);
  assert.equal(sent.length, 1);

  const refused = await sendWatchingFrame("terminal-1", (_frame, done) => done(new Error("closed")), now);
  assert.equal(refused, false);

  const threw = await sendWatchingFrame(
    "terminal-1",
    () => {
      throw new Error("channel closed");
    },
    now,
  );
  assert.equal(threw, false);
});
