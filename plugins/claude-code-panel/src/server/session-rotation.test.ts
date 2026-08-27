import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryFor,
  forgetDelivery,
  noteDelivery,
  shouldLookForSuccessor,
} from "./session-rotation.server.ts";

const NOW = 1_700_000_000_000;

test("remembers a delivery until it is forgotten", () => {
  noteDelivery("session", { at: NOW, entryTotal: 3 });
  assert.deepEqual(deliveryFor("session"), { at: NOW, entryTotal: 3 });
  forgetDelivery("session");
  assert.equal(deliveryFor("session"), null);
});

test("looks for a successor only while a delivered prompt has gone unwritten", () => {
  const delivery = { at: NOW, entryTotal: 3 };
  // A cleared session still gets a cost-state line appended on its way out, so the count is the test rather than the file.
  assert.equal(shouldLookForSuccessor({ delivery, entryTotal: 3, now: NOW + 5000 }), true);
  // The prompt became an entry, so this is still the session it landed in.
  assert.equal(shouldLookForSuccessor({ delivery, entryTotal: 4, now: NOW + 5000 }), false);
  // A session cleared before its first prompt has no transcript at all.
  assert.equal(shouldLookForSuccessor({ delivery, entryTotal: null, now: NOW + 5000 }), true);
  assert.equal(shouldLookForSuccessor({ delivery: null, entryTotal: null, now: NOW }), false);
});

test("gives the CLI a moment to write, and gives up long after", () => {
  const delivery = { at: NOW, entryTotal: 3 };
  assert.equal(shouldLookForSuccessor({ delivery, entryTotal: 3, now: NOW + 200 }), false);
  assert.equal(shouldLookForSuccessor({ delivery, entryTotal: 3, now: NOW + 200_000 }), false);
});
