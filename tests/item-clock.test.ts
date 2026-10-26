import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemClock, waitingItems } from "../server/item-clock.ts";
import { tempDir } from "./helpers.ts";

const DAY = 24 * 3600 * 1000;
const T0 = new Date("2026-10-25T12:00:00.000Z");
const later = (days: number) => new Date(T0.getTime() + days * DAY);

const body = (...items: string[]) => `\n**Waiting on you**\n${items.join("\n")}\n\n**Claude's next steps**\n- z) [ ] not counted\n`;

test("waitingItems reads open items under Waiting on you only", () => {
  assert.deepEqual(
    waitingItems(body("- a) [ ] Pick a name", "- b) [x] ~~done~~", "- Nothing else.", "- a loose note")),
    [
      { key: "a", text: "Pick a name" },
      { key: "#a loose note", text: "a loose note" },
    ],
  );
});

test("an item turns overdue once it has sat unchanged past the limit", () => {
  const clock = new ItemClock(null);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7), 0);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(6), 7), 0);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(8), 7), 1);
});

test("rewording an item restarts its clock", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a short name"), later(8), 7), 0);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a short name"), later(16), 7), 1);
});

test("a ticked item is forgotten, so reopening it starts fresh", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  clock.observe("aaaaaaa", body("- a) [x] ~~Pick a name~~"), later(3), 7);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(8), 7), 0);
});

test("a limit of 0 means never overdue", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 0);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(400), 0), 0);
});

test("tabs keep separate clocks for the same letter", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  assert.equal(clock.observe("bbbbbbb", body("- a) [ ] Pick a name"), later(8), 7), 0);
});

test("prune drops tabs that were not seen", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  clock.observe("bbbbbbb", body("- a) [ ] Pick a name"), T0, 7);
  clock.prune(new Set(["bbbbbbb"]));
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(8), 7), 0);
  assert.equal(clock.observe("bbbbbbb", body("- a) [ ] Pick a name"), later(8), 7), 1);
});

test("the clock survives a restart through its file", (t) => {
  const path = join(tempDir(t), "state", "items.json");
  const first = new ItemClock(path);
  first.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  first.save();
  assert.equal(existsSync(path), true);

  const second = new ItemClock(path);
  assert.equal(second.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(8), 7), 1);
  assert.match(readFileSync(path, "utf8"), /"version": 1/);
});

test("an unreadable file starts an empty clock", (t) => {
  const path = join(tempDir(t), "items.json");
  const clock = new ItemClock(path);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7), 0);
});
