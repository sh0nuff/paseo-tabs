import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { listTabs } from "../server/tabs-list.ts";
import { DEFAULT_DISPLAY } from "../server/tabs-file.ts";
import { NOW, gitInit, makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const ONE = "wks_1111111aaaaaaa";
const TWO = "wks_2222222bbbbbbb";

function setup(t: { after: (fn: () => void) => void }) {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeWorkspaces(home, [
    { workspaceId: ONE, cwd: repo, title: "One" },
    { workspaceId: TWO, cwd: repo, title: "Two" },
  ]);
  return { home, repo };
}

test("listTabs returns this workspace's tabs with open-item counts", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeAgent(home, { id: "bbbbbbb2-full", cwd: repo, workspaceId: ONE, createdAt: "2026-10-24T10:00:00.000Z" });
  writeAgent(home, { id: "ccccccc3-full", cwd: repo, workspaceId: TWO });
  writeFileSync(
    join(repo, "TABS.md"),
    "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] one\n\n" +
      "**Claude's next steps**\n- b) [ ] two\n- c) [ ] three\n\n## 2. B title · bbbbbbb\n\n- x\n",
  );

  assert.deepEqual(listTabs(home, ONE, NOW), [
    { agentId: "aaaaaaa1-full", short: "aaaaaaa", number: 1, title: "A title", closed: false, waiting: 1, next: 2, status: "waiting", about: "" },
    { agentId: "bbbbbbb2-full", short: "bbbbbbb", number: 2, title: "B title", closed: false, waiting: 0, next: 0, status: null, about: "" },
  ]);
});

test("listTabs works without a TABS.md, with zero counts", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeAgent(home, { id: "bbbbbbb2-full", cwd: repo, workspaceId: ONE, archivedAt: "2026-10-24T11:00:00.000Z" });

  assert.deepEqual(listTabs(home, ONE, NOW), [
    { agentId: "aaaaaaa1-full", short: "aaaaaaa", number: 1, title: "A title", closed: false, waiting: 0, next: 0, status: null, about: "" },
  ]);
});

test("listTabs lists a closed tab that still has a section after the open ones", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE, archivedAt: "2026-10-24T11:00:00.000Z" });
  writeAgent(home, { id: "bbbbbbb2-full", cwd: repo, workspaceId: ONE, createdAt: "2026-10-24T10:00:00.000Z" });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] one\n");

  assert.deepEqual(
    listTabs(home, ONE, NOW).map((row) => [row.short, row.number, row.closed, row.waiting]),
    [
      ["bbbbbbb", 1, false, 0],
      ["aaaaaaa", 2, true, 1],
    ],
  );
});

test("listTabs uses the heading's title when Paseo has none for the tab", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE, title: null });
  writeFileSync(join(repo, "TABS.md"), "## 3. Shelf labels A1-A3 · aaaaaaa\n\nbody\n");

  assert.equal(listTabs(home, ONE, NOW)[0].title, "Shelf labels A1-A3");
});

test("listTabs returns nothing for an unknown workspace", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });

  assert.deepEqual(listTabs(home, "wks_9999999zzzzzzz", NOW), []);
});

test("listTabs gives each tab its About line and status", (t) => {
  const { home, repo } = setup(t);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE });
  writeFileSync(
    join(repo, "TABS.md"),
    "## 1. A title · aaaaaaa\n\n### About this tab\nFixing the login loop after a reset.\n\nLast updated 2026-10-24 12:00\n\n" +
      "**Waiting on you**\n- Nothing open.\n\n**Claude's next steps**\n- b) [ ] add a test\n",
  );

  const [row] = listTabs(home, ONE, NOW);

  assert.equal(row.about, "Fixing the login loop after a reset.");
  assert.equal(row.status, "next");
});

test("listTabs shortens long names unless told not to", (t) => {
  const { home, repo } = setup(t);
  const long = "I need to re-add the laptop to my phone's app since we moved";
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo, workspaceId: ONE, title: long });

  assert.equal(listTabs(home, ONE, NOW)[0].title, "Re-add the laptop to my phone's app…");
  assert.equal(listTabs(home, ONE, NOW, { ...DEFAULT_DISPLAY, shortenNames: false })[0].title, long);
});
