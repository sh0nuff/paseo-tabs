import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_DISPLAY } from "../server/tabs-file.ts";
import { startWatcher, syncAll } from "../server/watcher.ts";
import { ItemClock } from "../server/item-clock.ts";
import { NOW, gitInit, makeHome, tempDir, writeAgent } from "./helpers.ts";

test("syncAll syncs every folder that has agents", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const a = gitInit(join(root, "a"));
  const b = gitInit(join(root, "b"));
  const plain = join(root, "plain");
  mkdirSync(plain);
  writeAgent(home, { id: "aaaaaaa1", cwd: a });
  writeAgent(home, { id: "bbbbbbb2", cwd: b });
  writeAgent(home, { id: "ccccccc3", cwd: plain });

  assert.deepEqual(syncAll(home, NOW), { [a]: "created", [b]: "created", [plain]: "skipped" });
});

test("syncAll keeps going after one folder fails", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const broken = gitInit(join(root, "broken"));
  mkdirSync(join(broken, "TABS.md")); // a folder where the file should be
  const fine = gitInit(join(root, "fine"));
  writeAgent(home, { id: "aaaaaaa1", cwd: broken });
  writeAgent(home, { id: "bbbbbbb2", cwd: fine });
  const quiet = t.mock.method(console, "error", () => {});

  assert.deepEqual(syncAll(home, NOW), { [broken]: "error", [fine]: "created" });
  assert.equal(quiet.mock.callCount(), 1);
});

test("startWatcher syncs once at start and again after a change", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo }, new Date("2026-10-24T09:00:00Z"));

  const watcher = startWatcher(home, { intervalMs: 50 });
  t.after(watcher.stop);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);

  writeAgent(home, { id: "aaaaaaa1", cwd: repo, title: "Renamed title" }, new Date("2026-10-24T09:00:07Z"));
  await sleep(300);

  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. Renamed title · aaaaaaa$/m);
});

test("refresh re-syncs at once with the current display options", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n");
  let dots = false;
  const watcher = startWatcher(home, { intervalMs: 60_000, display: () => ({ ...DEFAULT_DISPLAY, statusDots: dots }) });
  t.after(watcher.stop);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);

  dots = true;
  watcher.refresh();

  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🟠 1\. A title · aaaaaaa$/m);
});

test("re-syncs when a tab edits TABS.md, with no change to Paseo's records", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  const watcher = startWatcher(home, { intervalMs: 50 });
  t.after(watcher.stop);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);

  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer me\n");
  await sleep(300);

  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🟠 1\. A title · aaaaaaa$/m);
});

test("syncAll turns a tab red once its waiting item sits past the limit", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n");
  const clockPath = join(root, "state", "items.json");
  const day = 24 * 3600 * 1000;

  syncAll(home, NOW, DEFAULT_DISPLAY, new ItemClock(clockPath));
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🟠 1\. A title · aaaaaaa$/m);

  syncAll(home, new Date(NOW.getTime() + 8 * day), DEFAULT_DISPLAY, new ItemClock(clockPath));
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🔴 1\. A title · aaaaaaa$/m);
});
