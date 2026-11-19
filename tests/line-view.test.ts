import { test } from "node:test";
import assert from "node:assert/strict";
import { lineView } from "../client/line-view.ts";

const COLOURS = { overdue: "#red", waiting: "#orange", next: "#blue", done: "#green" };
const LINES = {
  wks_1: { status: "waiting" as const, title: "Calendar setup", waiting: "Add the calendars", more: 0 },
  wks_2: { status: null, title: "New tab", waiting: "", more: 0 },
};

test("lineView shows the workspace's own line in its status colour", () => {
  assert.deepEqual(lineView(LINES, "wks_1", true, COLOURS), { text: "Calendar setup · Add the calendars", colour: "#orange" });
});

test("lineView draws no dot when dots are off or the tab has no status yet", () => {
  assert.deepEqual(lineView(LINES, "wks_1", false, COLOURS), { text: "Calendar setup · Add the calendars", colour: null });
  assert.deepEqual(lineView(LINES, "wks_2", true, COLOURS), { text: "New tab", colour: null });
});

test("lineView shows nothing for a workspace without a line, or before the lines arrive", () => {
  assert.equal(lineView(LINES, "wks_3", true, COLOURS), null);
  assert.equal(lineView(undefined, "wks_1", true, COLOURS), null);
});
