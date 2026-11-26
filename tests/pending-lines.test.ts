import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { storeLines, storeTabRows } from "../server/pending-lines.ts";
import { addItem, finishItem, updateItem } from "../server/pending-store.ts";
import { DEFAULT_DISPLAY } from "../server/tabs-file.ts";
import { NOW, gitInit, makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const ONE = "wks_1111111aaaaaaa";
const A = "aaaaaaa1-full";
const B = "bbbbbbb2-full";
const DAY = 24 * 3600 * 1000;

function setup(t: { after: (fn: () => void) => void }) {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  const dir = join(root, "pending");
  writeWorkspaces(home, [{ workspaceId: ONE, cwd: repo, title: "One" }]);
  writeAgent(home, { id: A, cwd: repo, workspaceId: ONE });
  writeAgent(home, { id: B, cwd: repo, workspaceId: ONE, createdAt: "2026-10-24T10:00:00.000Z" });
  return { home, repo, dir };
}

const F = (kind: "waiting" | "next", what: string) => ({ kind, what, action: "do", minutes: 5, why: "because" });
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

test("rows: counts and each status, with no items meaning done", (t) => {
  const { home, repo, dir } = setup(t);
  addItem(dir, ONE, repo, A, F("waiting", "old one"), ago(10));
  addItem(dir, ONE, repo, A, F("waiting", "fresh"), ago(1));
  addItem(dir, ONE, repo, A, F("next", "later"), ago(1));
  addItem(dir, ONE, repo, B, F("next", "only next"), ago(1));
  const rows = storeTabRows(home, dir, ONE, NOW, DEFAULT_DISPLAY);
  assert.deepEqual(rows.map((r) => [r.number, r.waiting, r.next, r.overdue, r.status, r.about]), [
    [1, 2, 1, 1, "overdue", ""],
    [2, 0, 1, 0, "next", ""],
  ]);
  assert.equal(rows[0].title, "A title");
});

test("rows: waiting, done and overdueAfterDays 0", (t) => {
  const { home, repo, dir } = setup(t);
  addItem(dir, ONE, repo, A, F("waiting", "fresh"), ago(1));
  const old = addItem(dir, ONE, repo, B, F("waiting", "old"), ago(30));
  let rows = storeTabRows(home, dir, ONE, NOW, DEFAULT_DISPLAY);
  assert.deepEqual(rows.map((r) => r.status), ["waiting", "overdue"]);
  rows = storeTabRows(home, dir, ONE, NOW, { ...DEFAULT_DISPLAY, overdueAfterDays: 0 });
  assert.deepEqual(rows.map((r) => [r.status, r.overdue]), [["waiting", 0], ["waiting", 0]]);
  finishItem(dir, ONE, B, old.letter, "done", null, ago(0));
  rows = storeTabRows(home, dir, ONE, NOW, DEFAULT_DISPLAY);
  assert.deepEqual(rows[1], { ...rows[1], waiting: 0, status: "done" });
});

test("rows: a closed tab with items has closed true and no-item closed tabs are left out", (t) => {
  const { home, repo, dir } = setup(t);
  writeAgent(home, { id: "ccccccc3-full", cwd: repo, workspaceId: ONE, archivedAt: "2026-10-24T11:00:00.000Z", createdAt: "2026-10-24T11:00:00.000Z" });
  writeAgent(home, { id: "ddddddd4-full", cwd: repo, workspaceId: ONE, archivedAt: "2026-10-24T11:00:00.000Z", createdAt: "2026-10-24T11:30:00.000Z" });
  addItem(dir, ONE, repo, "ccccccc3-full", F("waiting", "left behind"), ago(1));
  const rows = storeTabRows(home, dir, ONE, NOW, DEFAULT_DISPLAY);
  assert.deepEqual(rows.map((r) => [r.short, r.number, r.closed]), [["aaaaaaa", 1, false], ["bbbbbbb", 2, false], ["ccccccc", 3, true]]);
});

test("rows: unknown workspace gives none", (t) => {
  const { home, dir } = setup(t);
  assert.deepEqual(storeTabRows(home, dir, "wks_nope", NOW), []);
});

test("line: most urgent open tab, oldest open waiting what", (t) => {
  const { home, repo, dir } = setup(t);
  addItem(dir, ONE, repo, A, F("next", "n"), ago(1));
  addItem(dir, ONE, repo, B, F("waiting", "newer **ask**"), ago(2));
  const first = addItem(dir, ONE, repo, B, F("waiting", "older ask"), ago(3));
  updateItem(dir, ONE, B, first.letter, { what: "older ask" }, ago(3));
  const lines = storeLines(home, dir, NOW, DEFAULT_DISPLAY);
  assert.deepEqual(lines[ONE], { status: "waiting", title: "B title", waiting: "older ask", more: 1 });
});

test("line: overdue wins, and a workspace with no items is done", (t) => {
  const { home, repo, dir } = setup(t);
  assert.equal(storeLines(home, dir, NOW, DEFAULT_DISPLAY)[ONE].status, "done");
  addItem(dir, ONE, repo, A, F("waiting", "stale"), ago(9));
  addItem(dir, ONE, repo, B, F("waiting", "fresh"), ago(0));
  assert.equal(storeLines(home, dir, NOW, DEFAULT_DISPLAY)[ONE].status, "overdue");
  assert.equal(storeLines(home, dir, NOW, { ...DEFAULT_DISPLAY, overdueAfterDays: 0 })[ONE].status, "waiting");
});
