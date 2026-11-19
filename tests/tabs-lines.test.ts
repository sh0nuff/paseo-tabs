import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cachedFor, firstWaiting, workspaceLines } from "../server/tabs-lines.ts";
import { ItemClock } from "../server/item-clock.ts";
import { DEFAULT_DISPLAY } from "../server/tabs-file.ts";
import { lineText } from "../shared/tabs-rpc.ts";
import { NOW, gitInit, makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const ONE = "wks_1111111aaaaaaa";
const TWO = "wks_2222222bbbbbbb";
const LATER = "2026-10-24T10:00:00.000Z";
const CLOSED = "2026-10-24T11:00:00.000Z";

function setup(t: { after: (fn: () => void) => void }, archivedOne: string | null = null) {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeWorkspaces(home, [
    { workspaceId: ONE, cwd: repo, title: "One", archivedAt: archivedOne },
    { workspaceId: TWO, cwd: repo, title: "Two" },
  ]);
  return { home, repo };
}

test("each workspace gets its own open tab, name and first waiting item", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeAgent(home, { id: "ccccccc3-full", cwd: repo, workspaceId: TWO });
  writeFileSync(
    join(repo, "TABS.md"),
    "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] Add the calendars (about 10 min) (OpenTodo task 1234abcd)\n\n" +
      "## 1. C title · ccccccc\n\n**Claude's next steps**\n- b) [ ] Write the plan\n",
  );

  assert.deepEqual(workspaceLines(home, NOW), {
    [ONE]: { status: "waiting", title: "A title", waiting: "Add the calendars", more: 0 },
    [TWO]: { status: "next", title: "C title", waiting: "", more: 0 },
  });
});

test("the most urgent open tab shows, and the other open tabs are counted", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeAgent(home, { id: "bbbbbbb2-full", cwd: repo, workspaceId: ONE, createdAt: LATER });
  const mine = "## 1. A title · aaaaaaa\n\n**Claude's next steps**\n- a) [ ] mine\n\n";
  writeFileSync(join(repo, "TABS.md"), `${mine}## 2. B title · bbbbbbb\n\n**Waiting on you**\n- b) [ ] yours\n`);

  assert.deepEqual(workspaceLines(home, NOW)[ONE], { status: "waiting", title: "B title", waiting: "yours", more: 1 });

  // On a tie the newer tab shows.
  writeFileSync(join(repo, "TABS.md"), `${mine}## 2. B title · bbbbbbb\n\n**Claude's next steps**\n- b) [ ] later\n`);
  assert.equal(workspaceLines(home, NOW)[ONE].title, "B title");
});

test("closed tabs never show", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE, archivedAt: CLOSED });
  writeAgent(home, { id: "bbbbbbb2-full", cwd: repo, workspaceId: ONE, createdAt: LATER });
  writeAgent(home, { id: "ccccccc3-full", cwd: repo, workspaceId: TWO, archivedAt: CLOSED });
  writeFileSync(
    join(repo, "TABS.md"),
    "## 1. A title · aaaaaaa · closed\n\n**Waiting on you**\n- a) [ ] yours\n\n" +
      "## 2. B title · bbbbbbb\n\n**Done**\n- b) [x] ~~finished~~\n\n" +
      "## 1. C title · ccccccc · closed\n\n**Claude's next steps**\n- c) [ ] later\n",
  );

  assert.deepEqual(workspaceLines(home, NOW), { [ONE]: { status: "done", title: "B title", waiting: "", more: 0 } });
});

test("a folder with no TABS.md gives no lines", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });

  assert.deepEqual(workspaceLines(home, NOW), {});
});

test("a tab with no section yet shows its name and no status", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeAgent(home, { id: "ccccccc3-full", cwd: repo, workspaceId: TWO });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] yours\n");

  assert.deepEqual(workspaceLines(home, NOW)[TWO], { status: null, title: "C title", waiting: "", more: 0 });
});

test("archived workspaces get no line", (t) => {
  const { home, repo } = setup(t, CLOSED);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] yours\n");

  assert.equal(workspaceLines(home, NOW)[ONE], undefined);
});

test("an item waiting past the limit makes the line overdue", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] yours\n");
  const clock = new ItemClock(null);

  // The watcher records each item's age; the line only reads it.
  clock.observe("aaaaaaa", "**Waiting on you**\n- a) [ ] yours\n", NOW, 7);
  const later = new Date(NOW.getTime() + 8 * 24 * 3600 * 1000);
  assert.equal(workspaceLines(home, later, DEFAULT_DISPLAY, clock)[ONE].status, "overdue");
});

test("reading the lines never changes the item ages the watcher keeps", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  const clock = new ItemClock(null);
  const whole = "**Waiting on you**\n- a) [ ] yours\n";
  clock.observe("aaaaaaa", whole, NOW, 7);

  // Five days on, TABS.md is caught halfway through a write, with the item cut short.
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] yo");
  workspaceLines(home, new Date(NOW.getTime() + 5 * 24 * 3600 * 1000), DEFAULT_DISPLAY, clock);

  // Eight days on, the item is still as old as it was, so it is overdue.
  assert.equal(clock.observe("aaaaaaa", whole, new Date(NOW.getTime() + 8 * 24 * 3600 * 1000), 7), 1);
});

test("firstWaiting cleans the first open item under Waiting on you", () => {
  assert.equal(
    firstWaiting("**Waiting on you**\n- b) [ ] Copy the **four** passwords into `Bitwarden` (about 5 min)\n- c) [ ] later\n"),
    "Copy the four passwords into Bitwarden",
  );
  assert.equal(firstWaiting("**Waiting on you**\n- [Read the guide](https://example.com/guide) first\n"), "Read the guide first");
  assert.equal(firstWaiting("**Waiting on you**\n- a) [ ] (about 5 min)\n"), "");
  assert.equal(firstWaiting("**Waiting on you**\n- a) [x] ~~done~~\n\n**Claude's next steps**\n- b) [ ] mine\n"), "");
  const long = firstWaiting(`**Waiting on you**\n- a) [ ] ${"word ".repeat(80)}\n`);
  assert.equal(Array.from(long).length, 160);
  assert.ok(long.endsWith("…"));
});

test("lineText joins the name, the count of other open tabs and the waiting item", () => {
  assert.equal(
    lineText({ status: "waiting", title: "Calendar setup", waiting: "Add the calendars", more: 1 }),
    "Calendar setup +1 · Add the calendars",
  );
  assert.equal(lineText({ status: "next", title: "Status view", waiting: "", more: 0 }), "Status view");
});

test("cachedFor computes at most once per window", () => {
  let now = 0;
  let calls = 0;
  const get = cachedFor(2000, () => ++calls, () => now);
  assert.equal(get(), 1);
  now = 1999;
  assert.equal(get(), 1);
  now = 2000;
  assert.equal(get(), 2);
});

test("cachedFor works the answer out again when the clock steps back", () => {
  let now = 10_000;
  let calls = 0;
  const get = cachedFor(2000, () => ++calls, () => now);
  assert.equal(get(), 1);
  now = 5_000; // the system clock was set back
  assert.equal(get(), 2);
});
