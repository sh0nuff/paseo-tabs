import { test } from "node:test";
import assert from "node:assert/strict";
import { waitingLabel } from "../client/pending-age.ts";

const now = new Date("2026-11-27T12:00:00.000Z");

test("age label for 0, 1 and 5 days", () => {
  assert.equal(waitingLabel("2026-11-27T05:00:00-05:00", now), "Waiting since today");
  assert.equal(waitingLabel("2026-11-26T07:00:00-05:00", now), "Waiting 1 day");
  assert.equal(waitingLabel("2026-11-22T07:00:00-05:00", now), "Waiting 5 days");
});
