import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRecord, WorkspaceRecord } from "../server/paseo-state.ts";
import { DEFAULT_DISPLAY, aboutLine, countOpen, hasOpenItems, planFolder, renderFolder } from "../server/tabs-file.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const NEW = "No items yet. This tab hasn't written to this file.";

function agent(id: string, fields: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    title: `${id[0].toUpperCase()} title`,
    cwd: "/repo",
    workspaceId: "wks_1111111aaaaaaa",
    provider: "claude",
    createdAt: "2026-10-24T09:00:00.000Z",
    archivedAt: null,
    ...fields,
  };
}

function ws(id: string, title: string | null, archivedAt: string | null = null): WorkspaceRecord {
  return { id, cwd: "/repo", title, archivedAt };
}

const ONE = ws("wks_1111111aaaaaaa", "One");
const TWO = ws("wks_2222222bbbbbbb", "Two");

function sync(text: string, agents: AgentRecord[], workspaces: WorkspaceRecord[] = [ONE]): string {
  return renderFolder(planFolder(text, agents, workspaces, NOW));
}

test("numbers open tabs in the order they were opened", () => {
  const out = sync("", [
    agent("aaaaaaa1", { createdAt: "2026-10-24T10:00:00.000Z" }),
    agent("bbbbbbb2", { createdAt: "2026-10-24T09:00:00.000Z" }),
  ]);
  assert.equal(
    out,
    `## 1. B title · bbbbbbb\n\n${NEW}\n\n## 2. A title · aaaaaaa\n\n${NEW}\n`,
  );
});

test("a second pass changes nothing", () => {
  const agents = [agent("aaaaaaa1"), agent("bbbbbbb2", { createdAt: "2026-10-24T10:00:00.000Z" })];
  const out = sync("", agents);
  assert.equal(sync(out, agents), out);
});

test("groups two workspaces with their own numbers", () => {
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-24T09:00:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T10:00:00.000Z" }),
  ];
  const out = sync("", agents, [ONE, TWO]);
  assert.equal(
    out,
    `# One · 1111111\n\n## 1. A title · aaaaaaa\n\n${NEW}\n\n` +
      `# Two · 2222222\n\n## 1. B title · bbbbbbb\n\n${NEW}\n`,
  );
  assert.equal(sync(out, agents, [ONE, TWO]), out);
});

test("one workspace gets no group line", () => {
  const out = sync("# One · 1111111\n\n## 1. A title · aaaaaaa\n\nbody\n", [agent("aaaaaaa1")]);
  assert.equal(out, "## 1. A title · aaaaaaa\n\nbody\n");
});

test("moves closed tabs to the bottom, marked closed", () => {
  const out = sync(
    "## 1. Shut · aaaaaaa\n\n- a) [ ] open item\n\n## 2. Open · bbbbbbb\n\nb body\n",
    [
      agent("aaaaaaa1", { title: "Shut", archivedAt: "2026-10-24T11:00:00.000Z" }),
      agent("bbbbbbb2", { title: "Open", createdAt: "2026-10-24T10:00:00.000Z" }),
    ],
  );
  assert.equal(out, "## 1. Open · bbbbbbb\n\nb body\n\n## 2. Shut · aaaaaaa · closed\n\n- a) [ ] open item\n");
});

test("keeps a closed section with an open item after 24 hours", () => {
  const out = sync("## 1. Shut · aaaaaaa · closed\n\n- a) [ ] still open\n", [
    agent("aaaaaaa1", { title: "Shut", archivedAt: "2026-10-22T09:00:00.000Z" }),
  ]);
  assert.equal(out, "## 1. Shut · aaaaaaa · closed\n\n- a) [ ] still open\n");
});

test("keeps a closed section with nothing open for 24 hours", () => {
  const out = sync("## 1. Shut · aaaaaaa · closed\n\n- a) [x] ~~done~~\n", [
    agent("aaaaaaa1", { title: "Shut", archivedAt: "2026-10-24T11:00:00.000Z" }),
  ]);
  assert.equal(out, "## 1. Shut · aaaaaaa · closed\n\n- a) [x] ~~done~~\n");
});

test("drops a closed section with nothing open after 24 hours", () => {
  const out = sync(
    "## 1. Open · bbbbbbb\n\nb body\n\n## 2. Shut · aaaaaaa · closed\n\n- a) [x] ~~done~~\n",
    [
      agent("aaaaaaa1", { title: "Shut", archivedAt: "2026-10-22T09:00:00.000Z" }),
      agent("bbbbbbb2", { title: "Open" }),
    ],
  );
  assert.equal(out, "## 1. Open · bbbbbbb\n\nb body\n");
});

test("a tab closed before it had a section gets none", () => {
  const out = sync("", [agent("aaaaaaa1", { archivedAt: "2026-10-24T11:00:00.000Z" })]);
  assert.equal(out, "");
});

test("treats lines starting with Nothing as no items", () => {
  assert.equal(hasOpenItems("- Nothing here. All done.\n- a) [x] ~~done~~\n"), false);
  assert.equal(hasOpenItems("- b) [x] ~~moved~~ (moved to 2f)\n- [x] plain done\n"), false);
  assert.equal(hasOpenItems("**Done**\n- c) [ ] open\n"), true);
  assert.equal(hasOpenItems("- a stray bullet\n"), true);
});

test("follows a rename and keeps the tab's text", () => {
  const out = sync("## 3. Old name · aaaaaaa\n\n### About this tab\nStuff.\n\n- a) [ ] item\n", [
    agent("aaaaaaa1", { title: "New name" }),
  ]);
  assert.equal(out, "## 1. New name · aaaaaaa\n\n### About this tab\nStuff.\n\n- a) [ ] item\n");
});

test("keeps a hash line inside a section", () => {
  const text = "## 1. A title · aaaaaaa\n\n# Notes\nkept\n\n## 2. B title · bbbbbbb\n\nb body\n";
  const out = sync(text, [agent("aaaaaaa1"), agent("bbbbbbb2", { createdAt: "2026-10-24T10:00:00.000Z" })]);
  assert.equal(out, text);
});

test("collapses whitespace in titles", () => {
  const out = sync(
    "",
    [
      agent("aaaaaaa1", { title: "Two\nlines   here", workspaceId: ONE.id }),
      agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T10:00:00.000Z" }),
    ],
    [ws(ONE.id, "Spaced\n  out"), TWO],
  );
  assert.match(out, /^# Spaced out · 1111111$/m);
  assert.match(out, /^## 1\. Two lines here · aaaaaaa$/m);
});

test("keeps the heading's title when Paseo has none for the tab", () => {
  const out = sync("## 4. Shelf labels A1-A3 · 8ad9b52\n\nbody\n", [
    agent("8ad9b52-full", { title: null }),
  ]);
  assert.equal(out, "## 1. Shelf labels A1-A3 · 8ad9b52\n\nbody\n");
});

test("keeps a closed heading's title when Paseo has none for the tab", () => {
  const out = sync("## 5. Shelf labels B1-B3 · 2215f27 · closed\n\n- a) [ ] item\n", [
    agent("2215f27-full", { title: null, archivedAt: "2026-10-24T11:00:00.000Z" }),
  ]);
  assert.equal(out, "## 1. Shelf labels B1-B3 · 2215f27 · closed\n\n- a) [ ] item\n");
});

test("a new tab with no title is untitled", () => {
  assert.equal(sync("", [agent("aaaaaaa1", { title: null })]), `## 1. untitled · aaaaaaa\n\n${NEW}\n`);
});

test("keeps a closed section whose only open item is indented after 24 hours", () => {
  const text = "## 1. Shut · aaaaaaa · closed\n\n- a) [x] ~~parent~~\n  - b) [ ] still open\n";
  const out = sync(text, [agent("aaaaaaa1", { title: "Shut", archivedAt: "2026-10-22T09:00:00.000Z" })]);
  assert.equal(out, text);
});

test("counts indented, starred and plus bullets as open items", () => {
  assert.equal(hasOpenItems("- a) [x] ~~done~~\n  - b) [ ] nested\n"), true);
  assert.equal(hasOpenItems("* c) [ ] starred\n"), true);
  assert.equal(hasOpenItems("+ d) [ ] plus\n"), true);
  assert.equal(hasOpenItems("1. [ ] numbered\n"), true);
  assert.equal(hasOpenItems("  - [x] nested done\n  * e) [x] ~~done~~\n  - Nothing left\n"), false);
});

test("settles with a workspace id that isn't hex", () => {
  const alpha = ws("wks_mG4efdeZ9Bwh", "Alpha");
  const agents = [
    agent("aaaaaaa1", { workspaceId: alpha.id }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T10:00:00.000Z" }),
  ];
  const out = sync("", agents, [alpha, TWO]);
  assert.match(out, /^# Alpha · mG4efde$/m);
  assert.equal(sync(out, agents, [alpha, TWO]), out);
});

const WAITING = "\n**Waiting on you**\n- a) [ ] answer me\n\n**Claude's next steps**\n- b) [ ] later\n";
const NEXT_ONLY = "\n**Waiting on you**\n- Nothing open.\n\n**Claude's next steps**\n- b) [ ] later\n";
const ALL_DONE = "\n**Waiting on you**\n- Nothing open.\n\n**Done**\n- a) [x] ~~done~~\n";

test("marks a tab waiting on you with an orange dot", () => {
  assert.equal(sync(`## 1. A title · aaaaaaa\n${WAITING}`, [agent("aaaaaaa1")]), `## 🟠 1. A title · aaaaaaa\n${WAITING}`);
});

test("marks a tab with only Claude's next steps with a blue dot", () => {
  assert.equal(sync(`## 1. A title · aaaaaaa\n${NEXT_ONLY}`, [agent("aaaaaaa1")]), `## 🔵 1. A title · aaaaaaa\n${NEXT_ONLY}`);
});

test("marks a tab with nothing open with a tick", () => {
  assert.equal(sync(`## 1. A title · aaaaaaa\n${ALL_DONE}`, [agent("aaaaaaa1")]), `## ✅ 1. A title · aaaaaaa\n${ALL_DONE}`);
});

test("gives no dot to a new tab or a closed one", () => {
  const out = sync(`## 2. Shut · bbbbbbb\n${WAITING}`, [
    agent("aaaaaaa1", { createdAt: "2026-10-24T10:00:00.000Z" }),
    agent("bbbbbbb2", { title: "Shut", archivedAt: "2026-10-24T11:00:00.000Z" }),
  ]);
  assert.equal(out, `## 1. A title · aaaaaaa\n\n${NEW}\n\n## 2. Shut · bbbbbbb · closed\n${WAITING}`);
});

test("reads a heading with a dot back, and a second pass changes nothing", () => {
  const agents = [agent("aaaaaaa1", { title: null })];
  const out = sync(`## 🔵 4. Shelf label C1 · aaaaaaa\n${WAITING}`, agents);
  assert.equal(out, `## 🟠 1. Shelf label C1 · aaaaaaa\n${WAITING}`);
  assert.equal(sync(out, agents), out);
});

test("leaves dots off when the setting is off", () => {
  const out = renderFolder(
    planFolder(`## 🟠 1. A title · aaaaaaa\n${WAITING}`, [agent("aaaaaaa1")], [ONE], NOW, { ...DEFAULT_DISPLAY, statusDots: false }),
  );
  assert.equal(out, `## 1. A title · aaaaaaa\n${WAITING}`);
});

test("shortens long tab and workspace names when the setting is on", () => {
  const out = sync(
    "",
    [
      agent("aaaaaaa1", { title: "I need to re-add the laptop to my phone's app since we moved", workspaceId: ONE.id }),
      agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T10:00:00.000Z" }),
    ],
    [ws(ONE.id, '"Make `proj new` work on the server. The `gh` token is being g'), TWO],
  );
  assert.match(out, /^# Make proj new work on the server · 1111111$/m);
  assert.match(out, /^## 1\. Re-add the laptop to my phone's app… · aaaaaaa$/m);
});

test("keeps long names when the setting is off", () => {
  const long = "I need to re-add the laptop to my phone's app since we moved";
  const out = renderFolder(
    planFolder("", [agent("aaaaaaa1", { title: long })], [ONE], NOW, { ...DEFAULT_DISPLAY, shortenNames: false }),
  );
  assert.match(out, new RegExp(`^## 1\\. ${long} · aaaaaaa$`, "m"));
});

test("keeps a hand-written heading name whole when Paseo has none, however long", () => {
  const name = "Shelf labels A1-A3, the second batch, with the new photos from the studio";
  const out = sync(`## 4. ${name} · aaaaaaa\n\nbody\n`, [agent("aaaaaaa1", { title: null })]);
  assert.equal(out, `## 1. ${name} · aaaaaaa\n\nbody\n`);
});

test("never shows a tick over an unticked box", () => {
  const body = "\n**Waiting on you**\n- Nothing open.\n\n**Done**\n- a) [x] ~~done~~\n- c) [ ] left under Done\n";
  assert.equal(sync(`## 1. A title · aaaaaaa\n${body}`, [agent("aaaaaaa1")]), `## 🔵 1. A title · aaaaaaa\n${body}`);
});

test("aboutLine drops a leading bullet", () => {
  assert.equal(aboutLine("\n### About this tab\n- Fixing the login loop.\n"), "Fixing the login loop.");
});

test("keeps unknown sections below the tabs", () => {
  const out = sync("## Notes\n\nfree text\n\n## 1. A title · aaaaaaa\n\nbody\n", [agent("aaaaaaa1")]);
  assert.equal(out, "## 1. A title · aaaaaaa\n\nbody\n\n## Notes\n\nfree text\n");
});

test("keeps text above the first heading", () => {
  const out = sync("Intro line\n\n## 1. A title · aaaaaaa\n\nbody\n", [agent("aaaaaaa1")]);
  assert.equal(out, "Intro line\n\n## 1. A title · aaaaaaa\n\nbody\n");
});

test("keeps stray text under a group line", () => {
  const out = sync("# Gone · 9999999\nstray note\n\n## 1. A title · aaaaaaa\n\nbody\n", [agent("aaaaaaa1")]);
  assert.equal(out, "## 1. A title · aaaaaaa\n\nbody\n\nstray note\n");
});

test("a brought-back tab moves up with its items", () => {
  const out = sync(
    "## 1. Open · bbbbbbb\n\nb body\n\n## 2. Back · aaaaaaa · closed\n\n- a) [ ] item\n",
    [
      agent("aaaaaaa1", { title: "Back", createdAt: "2026-10-24T08:00:00.000Z" }),
      agent("bbbbbbb2", { title: "Open", createdAt: "2026-10-24T10:00:00.000Z" }),
    ],
  );
  assert.equal(out, "## 1. Back · aaaaaaa\n\n- a) [ ] item\n\n## 2. Open · bbbbbbb\n\nb body\n");
});

test("a section re-keyed to a new tab follows it, and the old tab gets none", () => {
  const out = sync("## 2. Old tab · ccccccc\n\n### About this tab\nContinues aaaaaaa\n\n- a) [ ] item\n", [
    agent("aaaaaaa1", { title: "Old tab", archivedAt: "2026-10-22T09:00:00.000Z" }),
    agent("ccccccc3", { title: "New tab", createdAt: "2026-10-24T11:00:00.000Z" }),
  ]);
  assert.equal(out, "## 1. New tab · ccccccc\n\n### About this tab\nContinues aaaaaaa\n\n- a) [ ] item\n");
});

test("an archived workspace's group comes last, marked archived", () => {
  const out = sync(
    "## 1. A title · aaaaaaa · closed\n\n- a) [ ] item\n",
    [
      agent("aaaaaaa1", {
        workspaceId: TWO.id,
        createdAt: "2026-10-24T08:00:00.000Z",
        archivedAt: "2026-10-24T11:00:00.000Z",
      }),
      agent("bbbbbbb2", { workspaceId: ONE.id, createdAt: "2026-10-24T10:00:00.000Z" }),
    ],
    [ws(ONE.id, "Live"), ws(TWO.id, "Old", "2026-10-24T11:00:00.000Z")],
  );
  assert.equal(
    out,
    `# Live · 1111111\n\n## 1. B title · bbbbbbb\n\n${NEW}\n\n` +
      "# Old · 2222222 · archived\n\n## 1. A title · aaaaaaa · closed\n\n- a) [ ] item\n",
  );
});

test("tabs with no workspace form an Other tabs group", () => {
  const out = sync("", [
    agent("aaaaaaa1", { workspaceId: null }),
    agent("bbbbbbb2", { workspaceId: ONE.id, createdAt: "2026-10-24T10:00:00.000Z" }),
  ]);
  assert.equal(
    out,
    `# Other tabs · 0000000\n\n## 1. A title · aaaaaaa\n\n${NEW}\n\n` +
      `# One · 1111111\n\n## 1. B title · bbbbbbb\n\n${NEW}\n`,
  );
});

test("countOpen counts open items under one label", () => {
  const body = [
    "### About this tab",
    "x",
    "",
    "**Waiting on you**",
    "- a) [ ] one",
    "- b) [x] ~~done~~",
    "- c) [ ] two",
    "",
    "**Claude's next steps**",
    "- d) [ ] three",
    "- Nothing else.",
    "",
    "**Done**",
    "- e) [x] ~~old~~",
    "- f) [ ] misplaced",
    "",
  ].join("\n");
  assert.equal(countOpen(body, "Waiting on you"), 2);
  assert.equal(countOpen(body, "Claude's next steps"), 1);
  assert.equal(countOpen("no labels here\n", "Waiting on you"), 0);
});
