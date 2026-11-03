import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ItemClock, clockPath, tickedLetters, waitingItems } from "../server/item-clock.ts";
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

test("two items sharing a letter keep separate clocks", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] One thing", "- a) [ ] Another thing"), T0, 7);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] One thing", "- a) [ ] Another thing"), later(8), 7), 2);
});

test("the clock file depends on the Paseo home, so two daemons keep apart", () => {
  const env = { XDG_STATE_HOME: "/state", HOME: "/h" };
  assert.notEqual(clockPath(env, "/one/.paseo"), clockPath(env, "/two/.paseo"));
  assert.match(clockPath(env, "/one/.paseo"), /^\/state\/paseo-tabs\/items-[0-9a-f]{8}\.json$/);
  assert.match(clockPath({ HOME: "/h" }, "/one/.paseo"), /^\/h\/\.local\/state\/paseo-tabs\//);
});

test("an entry that can't be read starts its item fresh", (t) => {
  const path = join(tempDir(t), "items.json");
  writeFileSync(path, JSON.stringify({ version: 1, items: { "aaaaaaa:a": { text: "Pick a name", since: "not a date" } } }));
  const clock = new ItemClock(path);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7), 0);
  assert.equal(clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), later(8), 7), 1);
});

test("the clock file is private to the user", (t) => {
  const path = join(tempDir(t), "state", "items.json");
  const clock = new ItemClock(path);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  clock.save();
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("nextDue gives the earliest moment an item will turn overdue", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7);
  clock.observe("bbbbbbb", body("- a) [ ] Pick a name"), later(2), 7);
  assert.equal(clock.nextDue(7, T0.getTime()), later(7).getTime());
  assert.equal(clock.nextDue(7, later(8).getTime()), later(9).getTime());
  assert.equal(clock.nextDue(7, later(20).getTime()), null);
  assert.equal(clock.nextDue(0, T0.getTime()), null);
});

const TICKED = "\n**Claude's next steps**\n- a) [ ] open\n\n**Done**\n- b) [x] ~~done~~\n";
const REOPENED = "\n**Claude's next steps**\n- a) [ ] open\n- b) [ ] done after all\n";

test("a ticked item expires a day after it was first seen ticked", () => {
  const clock = new ItemClock(null);
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, T0, DAY), new Set());
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, later(0.9), DAY), new Set());
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, later(1.1), DAY), new Set(["b"]));
});

test("unticking an item forgets its tick", () => {
  const clock = new ItemClock(null);
  clock.expiredTicks("aaaaaaa", TICKED, T0, DAY);
  clock.expiredTicks("aaaaaaa", REOPENED, later(1 / 24), DAY);
  clock.expiredTicks("aaaaaaa", TICKED, later(1.05), DAY);
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, later(1.1), DAY), new Set());
});

test("tick times survive a restart", (t) => {
  const path = join(tempDir(t), "state", "items.json");
  const first = new ItemClock(path);
  first.expiredTicks("aaaaaaa", TICKED, T0, DAY);
  first.save();

  const second = new ItemClock(path);
  assert.deepEqual(second.expiredTicks("aaaaaaa", TICKED, later(1.1), DAY), new Set(["b"]));
  assert.match(readFileSync(path, "utf8"), /"version": 1/);
});

test("a tick entry without a readable date starts fresh", (t) => {
  const path = join(tempDir(t), "items.json");
  writeFileSync(path, JSON.stringify({ version: 1, items: {}, ticked: { "aaaaaaa:b": "not a date" } }));
  const clock = new ItemClock(path);
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, T0, DAY), new Set());
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, later(1.1), DAY), new Set(["b"]));
});

test("nextTickExpiry gives the earliest moment a tick expires", () => {
  const clock = new ItemClock(null);
  clock.observe("aaaaaaa", body("- a) [ ] Pick a name"), T0, 7); // a waiting item, not a tick
  clock.expiredTicks("aaaaaaa", TICKED, later(0.25), DAY);
  clock.expiredTicks("bbbbbbb", TICKED, later(0.5), DAY);
  assert.equal(clock.nextTickExpiry(DAY, T0.getTime()), later(1.25).getTime());
  assert.equal(clock.nextTickExpiry(DAY, later(1.3).getTime()), later(1.5).getTime());
  assert.equal(clock.nextTickExpiry(DAY, later(2).getTime()), null);
  // and ticks never count as waiting items turning overdue
  assert.equal(clock.nextDue(7, later(7.1).getTime()), null);
});

test("prune drops the tick times of tabs that are gone", () => {
  const clock = new ItemClock(null);
  clock.expiredTicks("aaaaaaa", TICKED, T0, DAY);
  clock.expiredTicks("bbbbbbb", TICKED, T0, DAY);
  clock.prune(new Set(["bbbbbbb"]));
  assert.deepEqual(clock.expiredTicks("aaaaaaa", TICKED, later(1.1), DAY), new Set());
  assert.deepEqual(clock.expiredTicks("bbbbbbb", TICKED, later(1.1), DAY), new Set(["b"]));
});

test("tickedLetters skips item-shaped lines in code blocks and comments", () => {
  const body = [
    "",
    "**Done**",
    "- a) [x] ~~real~~",
    "",
    "~~~",
    "- b) [x] ~~example~~",
    "~~~",
    "<!--",
    "- c) [x] ~~example~~",
    "-->",
    "  ```",
    "- d) [x] ~~example~~",
    "  ```",
    "",
  ].join("\n");
  assert.deepEqual(tickedLetters(body), ["a"]);
});
