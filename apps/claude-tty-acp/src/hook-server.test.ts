import assert from "node:assert/strict";
import test from "node:test";
import { HookServer } from "./hook-server.ts";

test("routes hooks only to their Claude session", async () => {
  const server = new HookServer();
  const received: string[] = [];
  server.register("first", async (payload) => {
    received.push(String(payload.hook_event_name));
    return { handled: true };
  });

  try {
    const endpoint = await server.start();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "first", hook_event_name: "Stop" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { handled: true });
    assert.deepEqual(received, ["Stop"]);

    const invalidToken = await fetch(endpoint.replace(/.$/, "x"), { method: "POST", body: "{}" });
    assert.equal(invalidToken.status, 404);
    await assert.rejects(server.dispatch({ session_id: "second", hook_event_name: "Stop" }), /No active adapter session/);
  } finally {
    await server.close();
  }
});
