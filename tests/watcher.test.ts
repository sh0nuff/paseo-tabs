import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startWatcher, syncAll } from "../server/watcher.ts";
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

  const stop = startWatcher(home, 50);
  t.after(stop);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);

  writeAgent(home, { id: "aaaaaaa1", cwd: repo, title: "Renamed title" }, new Date("2026-10-24T09:00:07Z"));
  await sleep(300);

  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. Renamed title · aaaaaaa$/m);
});
