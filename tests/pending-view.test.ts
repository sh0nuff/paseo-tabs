import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PaseoState } from "../server/paseo-state.ts";
import type { PendingFile } from "../server/pending-store.ts";
import { renderView } from "../server/pending-view.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { startWatcher, syncAll } from "../server/watcher.ts";
import { DEFAULT_DISPLAY } from "../server/tabs-file.ts";
import { gitInit, makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const FIX = join(import.meta.dirname, "fixtures", "pending-view");
const NOW = new Date("2026-11-26T14:00:00-05:00");
const read = (name: string) => readFileSync(join(FIX, name), "utf8");
const files = () => ["wks_1111111aaaaaaa.json", "wks_2222222bbbbbbb.json"].map((name) => JSON.parse(read(name)) as PendingFile);
const state = () => JSON.parse(read("state.json")) as PaseoState;
const ON = { ...DEFAULT_DISPLAY, pendingStore: true };

test("the fixture store renders as the expected TABS.md", () => {
  assert.equal(renderView(files(), state(), NOW, DEFAULT_DISPLAY, "/work/repo"), read("expected-TABS.md"));
});

test("a done item over 24 h leaves, except a tab's highest letter", () => {
  const view = renderView(files(), state(), NOW);
  assert.doesNotMatch(view, /Old answer/); // a) done 3 days ago, not the highest
  assert.match(view, /- b\) \[x\] ~~Second thing~~/); // highest, done 4 days ago
  assert.doesNotMatch(view, /First thing/);
  assert.match(view, /- c\) \[x\] ~~Write the report~~/); // done 4 h ago
});

function repoWithStore(t: { after: (fn: () => void) => void }) {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  const dir = join(root, "pending");
  mkdirSync(dir);
  // The view is kept only for installs that came from 1.x, after cut-over.
  writeFileSync(join(dir, "cutover"), "");
  writeWorkspaces(home, [{ workspaceId: "wks_1111111aaaaaaa", cwd: repo, title: "One" }]);
  return { home, repo, dir };
}
const item = (agentId: string, letter: string, status: "open" | "done", kind: "waiting" | "next" = "waiting") => ({
  letter, agentId, kind, what: `item ${letter}`, action: "x", minutes: 5, why: "y", status, picked: false,
  created: "2026-11-20T10:00:00-05:00", changed: "2026-11-20T10:00:00-05:00",
  done: status === "done" ? "2026-11-20T11:00:00-05:00" : null, note: null, linkedTask: null,
});

test("syncAll with pendingStore writes the view and ignores edits to the file", (t) => {
  const { home, repo, dir } = repoWithStore(t);
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeFileSync(join(dir, "wks_1111111aaaaaaa.json"), JSON.stringify({ workspaceId: "wks_1111111aaaaaaa", cwd: repo, highest: {}, items: [item("aaaaaaa1", "a", "open")] }));
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- z) [ ] typed by hand\n");
  syncAll(home, NOW, ON, undefined, dir);
  const text = readFileSync(join(repo, "TABS.md"), "utf8");
  assert.match(text, /^> Read-only view of the Pending panel's store\. Edits here are ignored\.\n/);
  assert.match(text, /^## 🟠 1\. A title · aaaaaaa$/m);
  assert.match(text, /- a\) \[ \] item a \(about 5 min\)/);
  assert.doesNotMatch(text, /typed by hand/);
});

test("a tab closed over 24 h with nothing open moves to TABS-DONE.md, one with an open item stays", (t) => {
  const { home, repo, dir } = repoWithStore(t);
  const gone = "2026-11-24T10:00:00.000Z";
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeAgent(home, { id: "bbbbbbb2", cwd: repo, archivedAt: gone });
  writeAgent(home, { id: "ccccccc3", cwd: repo, archivedAt: gone });
  writeFileSync(
    join(dir, "wks_1111111aaaaaaa.json"),
    JSON.stringify({ workspaceId: "wks_1111111aaaaaaa", cwd: repo, highest: {}, items: [item("aaaaaaa1", "a", "open"), item("bbbbbbb2", "a", "done"), item("ccccccc3", "a", "open")] }),
  );
  syncAll(home, NOW, ON, undefined, dir);
  const tabs = readFileSync(join(repo, "TABS.md"), "utf8");
  const done = readFileSync(join(repo, "TABS-DONE.md"), "utf8");
  assert.doesNotMatch(tabs, /bbbbbbb/);
  assert.match(done, /bbbbbbb · closed/);
  assert.match(tabs, /ccccccc · closed/);
  // a second pass changes nothing
  syncAll(home, NOW, ON, undefined, dir);
  assert.equal(readFileSync(join(repo, "TABS.md"), "utf8"), tabs);
  assert.equal(readFileSync(join(repo, "TABS-DONE.md"), "utf8"), done);
});

test("an unreadable store leaves TABS.md alone", (t) => {
  const { home, repo, dir } = repoWithStore(t);
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeFileSync(join(dir, "wks_1111111aaaaaaa.json"), "{not json");
  writeFileSync(join(repo, "TABS.md"), "keep me\n");
  const quiet = t.mock.method(console, "error", () => {});
  assert.deepEqual(syncAll(home, NOW, ON, undefined, dir), { [repo]: "skipped" });
  assert.equal(readFileSync(join(repo, "TABS.md"), "utf8"), "keep me\n");
  assert.equal(quiet.mock.callCount(), 1);
});

test("a closed tab moved out and then reactivated has one block in TABS.md and none in TABS-DONE.md", (t) => {
  const { home, repo, dir } = repoWithStore(t);
  const gone = "2026-11-24T10:00:00.000Z";
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeAgent(home, { id: "bbbbbbb2", cwd: repo, archivedAt: gone });
  const store = join(dir, "wks_1111111aaaaaaa.json");
  const write = (items: unknown[]) => writeFileSync(store, JSON.stringify({ workspaceId: "wks_1111111aaaaaaa", cwd: repo, highest: {}, items }));
  write([item("aaaaaaa1", "a", "open"), item("bbbbbbb2", "a", "done")]);
  syncAll(home, NOW, ON, undefined, dir);
  assert.match(readFileSync(join(repo, "TABS-DONE.md"), "utf8"), /bbbbbbb · closed/);
  // reactivated, with a new open item
  writeAgent(home, { id: "bbbbbbb2", cwd: repo, archivedAt: null });
  write([item("aaaaaaa1", "a", "open"), item("bbbbbbb2", "a", "done"), item("bbbbbbb2", "b", "open")]);
  syncAll(home, NOW, ON, undefined, dir);
  const tabs = readFileSync(join(repo, "TABS.md"), "utf8");
  assert.equal(tabs.match(/· bbbbbbb/g)?.length, 1);
  assert.match(tabs, /item b/);
  assert.doesNotMatch(readFileSync(join(repo, "TABS-DONE.md"), "utf8"), /bbbbbbb/);
});

test("the watcher renders the view once only the cut-over marker exists, without a restart", async (t) => {
  const { home, repo, dir } = repoWithStore(t);
  rmSync(join(dir, "cutover"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeFileSync(join(dir, "wks_1111111aaaaaaa.json"), JSON.stringify({ workspaceId: "wks_1111111aaaaaaa", cwd: repo, highest: {}, items: [item("aaaaaaa1", "a", "open")] }));
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- z) [ ] typed by hand\n");
  const watcher = startWatcher(home, { intervalMs: 50, pendingDir: dir });
  t.after(watcher.stop);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /typed by hand/);
  writeFileSync(join(dir, "cutover"), "");
  await sleep(500);
  const text = readFileSync(join(repo, "TABS.md"), "utf8");
  assert.match(text, /Read-only view/);
  assert.match(text, /item a/);
  assert.doesNotMatch(text, /typed by hand/);
});
