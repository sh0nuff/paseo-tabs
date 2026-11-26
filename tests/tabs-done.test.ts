import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord, PaseoState } from "../server/paseo-state.ts";
import { type FileIO, syncFolder } from "../server/folder-sync.ts";
import { ItemClock, nextLetter } from "../server/item-clock.ts";
import { DEFAULT_DISPLAY, TICKED_KEEP_MS, planFolder, renderFolder } from "../server/tabs-file.ts";
import { DONE_HEADER, moveFinishedSections } from "../server/tabs-done.ts";
import { NOW, gitInit, tempDir } from "./helpers.ts";

const LONG_AGO = "2026-10-22T09:00:00.000Z";
const RECENT = "2026-10-24T11:00:00.000Z";

function agent(id: string, cwd: string, fields: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    title: "Shut",
    cwd,
    workspaceId: "wks_1111111aaaaaaa",
    provider: "claude",
    createdAt: "2026-10-24T09:00:00.000Z",
    archivedAt: null,
    lastUserMessageAt: null,
    ...fields,
  };
}

const state = (...agents: AgentRecord[]): PaseoState => ({ agents, workspaces: [] });

const FINISHED = (id: string, n = 1) =>
  `## ${n}. Shut · ${id} · closed\n\n### About this tab\nSample.\n\n**Waiting on you**\n- Nothing open.\n\n**Done**\n- a) [x] ~~one~~\n`;

function setup(t: { after: (fn: () => void) => void }, tabs: string, done?: string) {
  const repo = gitInit(join(tempDir(t), "repo"));
  writeFileSync(join(repo, "TABS.md"), tabs);
  if (done !== undefined) writeFileSync(join(repo, "TABS-DONE.md"), done);
  return {
    repo,
    tabs: () => readFileSync(join(repo, "TABS.md"), "utf8"),
    done: () => (existsSync(join(repo, "TABS-DONE.md")) ? readFileSync(join(repo, "TABS-DONE.md"), "utf8") : null),
  };
}

test("test_open_item_stays", (t) => {
  const text = "## 1. Shut · aaaaaaa · closed\n\n**Waiting on you**\n- a) [ ] answer\n";
  const f = setup(t, text);
  syncFolder(f.repo, state(agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO })), NOW);
  assert.equal(f.tabs(), text);
  assert.equal(f.done(), null);
});

test("test_open_item_in_next_steps_stays", (t) => {
  const text = "## 1. Shut · aaaaaaa · closed\n\n**Claude's next steps**\n- b) [ ] later\n\n**Done**\n- a) [x] ~~one~~\n";
  const f = setup(t, text);
  syncFolder(f.repo, state(agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO })), NOW);
  assert.equal(f.tabs(), text);
  assert.equal(f.done(), null);
});

test("test_closed_and_empty_moves", (t) => {
  const f = setup(t, `## 1. Open · bbbbbbb\n\nb body\n\n${FINISHED("aaaaaaa", 2)}`);
  syncFolder(f.repo, state(agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO }), agent("bbbbbbb2", f.repo, { title: "Open" })), NOW);
  assert.equal(f.tabs(), "## 1. Open · bbbbbbb\n\nb body\n");
  assert.equal(f.done(), `${DONE_HEADER}\n\n${FINISHED("aaaaaaa", 2)}`);
});

test("test_closed_for_less_than_24h_stays", (t) => {
  const text = FINISHED("aaaaaaa");
  const f = setup(t, text);
  syncFolder(f.repo, state(agent("aaaaaaa1", f.repo, { archivedAt: RECENT })), NOW);
  assert.equal(f.tabs(), text);
  assert.equal(f.done(), null);
});

test("test_open_tab_never_moves", (t) => {
  const text = "## ✅ 1. Shut · aaaaaaa\n\n**Done**\n- a) [x] ~~one~~\n";
  const f = setup(t, text);
  syncFolder(f.repo, state(agent("aaaaaaa1", f.repo)), NOW);
  assert.equal(f.tabs(), text);
  assert.equal(f.done(), null);
});

test("test_unknown_paseo_state_counts_as_open", (t) => {
  const text = FINISHED("aaaaaaa");
  const f = setup(t, text);
  // Paseo's records could not be read: no agents at all.
  syncFolder(f.repo, state(), NOW);
  assert.equal(f.tabs(), text);
  assert.equal(f.done(), null);
  const pure = moveFinishedSections(text, "", { closedShortIds: new Set(["aaaaaaa"]), activeShortIds: new Set(), stateUnknown: true });
  assert.deepEqual(pure.moved, []);
  assert.equal(pure.tabs, text);
});

test("test_done_file_newest_first", (t) => {
  const f = setup(t, FINISHED("aaaaaaa", 1));
  const first = agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO });
  syncFolder(f.repo, state(first), NOW);
  writeFileSync(join(f.repo, "TABS.md"), `${FINISHED("bbbbbbb", 1)}`);
  syncFolder(f.repo, state(first, agent("bbbbbbb2", f.repo, { archivedAt: LONG_AGO })), NOW);
  assert.equal(f.done(), `${DONE_HEADER}\n\n${FINISHED("bbbbbbb", 1)}\n${FINISHED("aaaaaaa", 1)}`);
});

test("test_idempotent", (t) => {
  const f = setup(t, `## 1. Open · bbbbbbb\n\nb body\n\n${FINISHED("aaaaaaa", 2)}`);
  const s = state(agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO }), agent("bbbbbbb2", f.repo, { title: "Open" }));
  syncFolder(f.repo, s, NOW);
  const [tabs, done] = [f.tabs(), f.done()];
  assert.equal(syncFolder(f.repo, s, NOW), "unchanged");
  assert.equal(f.tabs(), tabs);
  assert.equal(f.done(), done);
});

test("test_crash_between_writes_duplicates_not_loses", (t) => {
  const f = setup(t, `## 1. Open · bbbbbbb\n\nb body\n\n${FINISHED("aaaaaaa", 2)}`);
  const s = state(agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO }), agent("bbbbbbb2", f.repo, { title: "Open" }));
  const crashing: FileIO = {
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    write: (path, text) => {
      if (path.endsWith("TABS.md")) throw new Error("crash");
      writeFileSync(path, text);
    },
    exclude: () => {},
  };
  assert.throws(() => syncFolder(f.repo, s, NOW, crashing));
  // The section is in both files, so none is lost.
  assert.match(f.tabs(), /aaaaaaa/);
  assert.match(f.done() ?? "", /aaaaaaa/);
  syncFolder(f.repo, s, NOW);
  assert.doesNotMatch(f.tabs(), /aaaaaaa/);
  assert.equal(f.done()?.split("· aaaaaaa").length, 2); // exactly one section
});

test("test_revived_tab_section_returns", (t) => {
  const f = setup(t, "## 1. Open · bbbbbbb\n\nb body\n", `${DONE_HEADER}\n\n${FINISHED("aaaaaaa", 5)}`);
  const s = state(agent("aaaaaaa1", f.repo), agent("bbbbbbb2", f.repo, { title: "Open", createdAt: "2026-10-24T10:00:00.000Z" }));
  syncFolder(f.repo, s, NOW);
  assert.match(f.tabs(), /^## ✅ 1\. Shut · aaaaaaa$/m);
  assert.match(f.tabs(), /- a\) \[x\] ~~one~~/);
  assert.doesNotMatch(f.done() ?? "", /aaaaaaa/);
  assert.equal(syncFolder(f.repo, s, NOW), "unchanged");
});

test("a revived tab that is also still in TABS.md is just removed from the done file", () => {
  const out = moveFinishedSections(
    "## 1. Shut · aaaaaaa\n\nlive\n",
    `${DONE_HEADER}\n\n${FINISHED("aaaaaaa")}`,
    { closedShortIds: new Set(), activeShortIds: new Set(["aaaaaaa"]), stateUnknown: false },
  );
  assert.equal(out.tabs, "## 1. Shut · aaaaaaa\n\nlive\n");
  assert.doesNotMatch(out.done, /aaaaaaa/);
});

const ticked = (...letters: string[]) => `\n**Done**\n${letters.map((l) => `- ${l}) [x] ~~item ${l}~~`).join("\n")}\n`;

test("test_highest_letter_kept_in_state_not_in_file", (t) => {
  const path = join(tempDir(t), "items.json");
  const clock = new ItemClock(path);
  const agents = [agent("aaaaaaa1", "/repo")];
  const section = `## 1. Shut · aaaaaaa\n${ticked("a", "b")}`;
  const pass = (text: string, at: Date) =>
    renderFolder(
      planFolder(text, agents, [], at, DEFAULT_DISPLAY, undefined, (short, body) => clock.expiredTicks(short, body, at, TICKED_KEEP_MS)),
    );
  pass(section, NOW);
  const later = new Date(NOW.getTime() + TICKED_KEEP_MS + 1000);
  const out = pass(section, later);
  assert.doesNotMatch(out, /\[x\]/); // the last ticked item left the file too
  clock.save();
  assert.equal(new ItemClock(path).highestLetter("aaaaaaa", out), "b");
});

test("test_next_letter_not_reused_after_last_item_leaves", () => {
  const clock = new ItemClock(null);
  const at = NOW;
  clock.expiredTicks("aaaaaaa", ticked("a", "b", "c"), at, TICKED_KEEP_MS);
  const emptied = "\n**Done**\n";
  assert.equal(clock.nextLetter("aaaaaaa", emptied), "d");
  // Whichever is higher wins, the file's or the state's.
  assert.equal(clock.nextLetter("aaaaaaa", "\n- f) [ ] later\n"), "g");
  assert.equal(clock.nextLetter("bbbbbbb", emptied), "a");
  assert.equal(nextLetter("z"), "aa");
  assert.equal(nextLetter("az"), "ba");
  assert.equal(nextLetter(undefined), "a");
});

test("test_done_file_git_excluded", (t) => {
  const f = setup(t, FINISHED("aaaaaaa"));
  syncFolder(f.repo, state(agent("aaaaaaa1", f.repo, { archivedAt: LONG_AGO })), NOW);
  const lines = readFileSync(join(f.repo, ".git", "info", "exclude"), "utf8").split("\n");
  assert.ok(lines.includes("TABS-DONE.md"));
  assert.ok(lines.includes("TABS.md"));
});
