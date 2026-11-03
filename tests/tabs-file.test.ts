import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRecord, WorkspaceRecord } from "../server/paseo-state.ts";
import {
  DEFAULT_DISPLAY,
  type DisplayOptions,
  aboutLine,
  compareLetters,
  countOpen,
  hasOpenItems,
  planFolder,
  renderFolder,
  withoutFinished,
} from "../server/tabs-file.ts";

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
    lastUserMessageAt: null,
    ...fields,
  };
}

function ws(id: string, title: string | null, archivedAt: string | null = null): WorkspaceRecord {
  return { id, cwd: "/repo", title, archivedAt, createdAt: "", pinnedAt: null };
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
    agent("ccccccc3", { workspaceId: TWO.id, createdAt: "2026-10-24T11:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-22T10:00:00.000Z" },
  ];
  const out = sync("", agents, workspaces);
  assert.equal(
    out,
    `# Two · 2222222\n\n## 1. B title · bbbbbbb\n\n${NEW}\n\n## 2. C title · ccccccc\n\n${NEW}\n\n` +
      `# One · 1111111\n\n## 1. A title · aaaaaaa\n\n${NEW}\n`,
  );
  assert.equal(sync(out, agents, workspaces), out);
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

test("marks a tab with an overdue item with a red dot", () => {
  const out = renderFolder(
    planFolder(`## 1. A title · aaaaaaa\n${WAITING}`, [agent("aaaaaaa1")], [ONE], NOW, DEFAULT_DISPLAY, () => 1),
  );
  assert.equal(out, `## 🔴 1. A title · aaaaaaa\n${WAITING}`);
});

test("reads a red heading back, and asks about each tab with a section", () => {
  const asked: string[] = [];
  const out = renderFolder(
    planFolder(`## 🔴 1. A title · aaaaaaa\n${WAITING}`, [agent("aaaaaaa1")], [ONE], NOW, DEFAULT_DISPLAY, (short) => {
      asked.push(short);
      return 0;
    }),
  );
  assert.equal(out, `## 🟠 1. A title · aaaaaaa\n${WAITING}`);
  assert.deepEqual(asked, ["aaaaaaa"]);
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
    `# One · 1111111\n\n## 1. B title · bbbbbbb\n\n${NEW}\n\n` +
      `# Other tabs · 0000000\n\n## 1. A title · aaaaaaa\n\n${NEW}\n`,
  );
});

function groupLines(out: string): string[] {
  return out.split("\n").filter((line) => line.startsWith("# "));
}

test("groups run newest workspace first", () => {
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-24T09:00:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T10:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-22T10:00:00.000Z" },
  ];
  assert.deepEqual(groupLines(sync("", agents, workspaces)), ["# Two · 2222222", "# One · 1111111"]);
});

test("workspaces made at the same moment go by id", () => {
  const agents = [
    agent("aaaaaaa1", { workspaceId: TWO.id, createdAt: "2026-10-24T08:00:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: ONE.id, createdAt: "2026-10-24T09:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-20T10:00:00.000Z" },
  ];
  assert.deepEqual(groupLines(sync("", agents, workspaces)), ["# One · 1111111", "# Two · 2222222"]);
});

test("a pinned workspace's group comes first", () => {
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-24T10:00:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T09:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z", pinnedAt: "2026-10-23T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-22T10:00:00.000Z" },
  ];
  assert.deepEqual(groupLines(sync("", agents, workspaces)), ["# One · 1111111", "# Two · 2222222"]);
});

test("latest message first follows the newest message to any tab", () => {
  // One's newest message went to a closed tab, after Two's last message.
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-24T10:00:00.000Z", lastUserMessageAt: "2026-10-24T10:05:00.000Z" }),
    agent("ccccccc3", {
      workspaceId: ONE.id,
      createdAt: "2026-10-24T10:30:00.000Z",
      lastUserMessageAt: "2026-10-24T11:30:00.000Z",
      archivedAt: "2026-10-24T11:45:00.000Z",
    }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T09:00:00.000Z", lastUserMessageAt: "2026-10-24T11:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-22T10:00:00.000Z" },
  ];
  const options: DisplayOptions = { ...DEFAULT_DISPLAY, workspaceOrder: "latestMessage" };
  const out = renderFolder(planFolder("## 2. C title · ccccccc · closed\n\n- a) [ ] still open\n", agents, workspaces, NOW, options));
  assert.deepEqual(groupLines(out), ["# One · 1111111", "# Two · 2222222"]);
});

test("a workspace order missing from older saved settings sorts newest first", () => {
  // One's tab is older and has the newer message, so only the newest order puts Two first.
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-24T09:00:00.000Z", lastUserMessageAt: "2026-10-24T11:30:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T10:00:00.000Z", lastUserMessageAt: "2026-10-24T11:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-22T10:00:00.000Z" },
  ];
  const { workspaceOrder: _, ...older } = DEFAULT_DISPLAY;
  const out = renderFolder(planFolder("", agents, workspaces, NOW, older as DisplayOptions));
  assert.deepEqual(groupLines(out), ["# Two · 2222222", "# One · 1111111"]);
});

test("a group whose workspace isn't listed sorts by its earliest tab", () => {
  const THREE = "wks_3333333ccccccc";
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-24T08:00:00.000Z" }),
    agent("ddddddd4", { workspaceId: ONE.id, createdAt: "2026-10-24T11:30:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-24T11:00:00.000Z" }),
    agent("ccccccc3", { workspaceId: THREE, createdAt: "2026-10-24T10:00:00.000Z" }),
  ];
  // One has no date of its own, Two does, and Three isn't listed at all.
  const workspaces = [ONE, { ...TWO, createdAt: "2026-10-23T12:00:00.000Z" }];
  const out = sync("", agents, workspaces);
  assert.deepEqual(groupLines(out), [`# ${THREE} · 3333333`, "# One · 1111111", "# Two · 2222222"]);
  assert.equal(sync(out, agents, workspaces), out);
});

test("tabs with no workspace come after the workspaces, before archived ones", () => {
  const agents = [
    agent("aaaaaaa1", { workspaceId: null, createdAt: "2026-10-24T08:00:00.000Z" }),
    agent("bbbbbbb2", { workspaceId: ONE.id, createdAt: "2026-10-24T10:00:00.000Z" }),
    agent("ccccccc3", { workspaceId: TWO.id, createdAt: "2026-10-24T07:00:00.000Z", archivedAt: "2026-10-24T11:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-23T10:00:00.000Z", archivedAt: "2026-10-24T11:00:00.000Z" },
  ];
  const out = sync("## 1. C title · ccccccc · closed\n\n- a) [ ] item\n", agents, workspaces);
  assert.deepEqual(groupLines(out), ["# One · 1111111", "# Other tabs · 0000000", "# Two · 2222222 · archived"]);
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

test("withoutFinished drops expired ticked items", () => {
  const body = [
    "",
    "### About this tab",
    "Fixing the login loop.",
    "",
    "**Waiting on you**",
    "- b) [ ] Try a reset on staging.",
    "",
    "**Claude's next steps**",
    "- d) [ ] Add a test.",
    "",
    "**Done**",
    "- a) [x] ~~Found the cause.~~",
    "- c) [x] ~~Fixed the second check.~~",
    "",
  ].join("\n");
  assert.equal(
    withoutFinished(body, new Set(["a", "c"])),
    "\n### About this tab\nFixing the login loop.\n\n**Waiting on you**\n- b) [ ] Try a reset on staging.\n\n" +
      "**Claude's next steps**\n- d) [ ] Add a test.\n\n**Done**\n",
  );
});

test("keeps the highest-lettered item even when it is ticked and expired", () => {
  const body = "\n**Done**\n- a) [x] ~~one~~\n- b) [x] ~~two~~\n";
  assert.equal(withoutFinished(body, new Set(["a", "b"])), "\n**Done**\n- b) [x] ~~two~~\n");
});

test("letters run a to z, then aa", () => {
  assert.deepEqual(["ab", "z", "aa", "b", "a"].sort(compareLetters), ["a", "b", "z", "aa", "ab"]);
  const body = "\n**Done**\n- y) [x] ~~y~~\n- aa) [x] ~~aa~~\n- z) [x] ~~z~~\n";
  assert.equal(withoutFinished(body, new Set(["y", "z", "aa"])), "\n**Done**\n- aa) [x] ~~aa~~\n");
});

test("keeps a ticked item with lines indented under it, or with [ ] on its line", () => {
  const body = [
    "",
    "**Done**",
    "- a) [x] ~~parent~~",
    "  - a detail under it",
    "- b) [x] ~~mostly done~~, one box [ ] left",
    "- c) [x] ~~loose item~~",
    "",
    "  A paragraph that belongs to c.",
    "- d) [ ] last",
    "",
  ].join("\n");
  assert.equal(withoutFinished(body, new Set(["a", "b", "c"])), body);
});

test("never removes unlettered ticked lines, open items, labels or other text", () => {
  const body = [
    "",
    "### About this tab",
    "a) [x] not a list line",
    "",
    "Last updated 2026-10-24 12:00",
    "",
    "**Waiting on you**",
    "- a) [ ] open",
    "- [x] plain ticked line",
    "  - b) [x] ~~indented~~",
    "* c) [x] ~~starred~~",
    "",
    "**Done**",
    "- d) [X] ~~capital X~~",
    "- e) [ ] last",
    "",
  ].join("\n");
  assert.equal(withoutFinished(body, new Set(["a", "b", "c", "d"])), body);
});

const FINISHED = "## ✅ 1. A title · aaaaaaa\n\n**Waiting on you**\n- Nothing open.\n\n**Done**\n- a) [x] ~~one~~\n- b) [x] ~~two~~\n";

test("planFolder with removeFinished off changes no section", () => {
  const options: DisplayOptions = { ...DEFAULT_DISPLAY, removeFinished: false };
  const out = renderFolder(planFolder(FINISHED, [agent("aaaaaaa1")], [ONE], NOW, options, undefined, () => new Set(["a", "b"])));
  assert.equal(out, FINISHED);
});

test("planFolder drops expired items, and a second pass changes nothing", () => {
  const pass = (text: string) =>
    renderFolder(planFolder(text, [agent("aaaaaaa1")], [ONE], NOW, DEFAULT_DISPLAY, undefined, () => new Set(["a", "b"])));
  const out = pass(FINISHED);
  assert.equal(out, "## ✅ 1. A title · aaaaaaa\n\n**Waiting on you**\n- Nothing open.\n\n**Done**\n- b) [x] ~~two~~\n");
  assert.equal(pass(out), out);
});

test("keeps a finished item whose text wraps onto the next line", () => {
  const body = "- a) [ ] Decide X\n- b) [x] ~~Did the long thing that wraps\nonto a second line~~\n- c) [ ] next\n";
  assert.equal(withoutFinished(body, new Set(["b"])), body);
});

test("removes a finished item followed straight by another item, a label or a heading", () => {
  const body = "- a) [x] ~~one~~\n1. a numbered note\n- b) [x] ~~two~~\n**Done**\n- c) [x] ~~three~~\n### Notes\n- d) [ ] last\n";
  assert.equal(withoutFinished(body, new Set(["a", "b", "c"])), "1. a numbered note\n**Done**\n### Notes\n- d) [ ] last\n");
});

test("keeps an item-shaped line inside a fenced code block", () => {
  const body = ["", "**Claude's next steps**", "- c) [ ] Try the new format:", "", "```", "- b) [x] ~~example line~~", "", "```", ""].join("\n");
  assert.equal(withoutFinished(body, new Set(["b"])), body);
});

test("keeps an item-shaped line inside an HTML comment", () => {
  const body = ["", "**Claude's next steps**", "- c) [ ] Try the new format:", "", "<!--", "- b) [x] ~~example line~~", "", "-->", ""].join("\n");
  assert.equal(withoutFinished(body, new Set(["b"])), body);
});

test("a fence closes only on the same kind of fence", () => {
  const body = ["", "- c) [ ] next", "", "```", "~~~", "- b) [x] ~~still inside~~", "", "```", ""].join("\n");
  assert.equal(withoutFinished(body, new Set(["b"])), body);
});

test("a letter inside a code block or a comment never counts as the section's highest", () => {
  const lines = ["", "**Done**", "- a) [x] ~~first~~", "- b) [x] ~~second~~", "", "```", "- y) [ ] example", "```", "", "<!--", "- z) [ ] example", "-->", ""];
  const expected = ["", "**Done**", "- b) [x] ~~second~~", "", "```", "- y) [ ] example", "```", "", "<!--", "- z) [ ] example", "-->", ""];
  assert.equal(withoutFinished(lines.join("\n"), new Set(["a", "b"])), expected.join("\n"));
});

test("latest message first counts closed tabs whose sections are gone", () => {
  const agents = [
    agent("aaaaaaa1", { workspaceId: ONE.id, createdAt: "2026-10-20T11:00:00.000Z", lastUserMessageAt: "2026-10-21T09:00:00.000Z" }),
    // One's newest message went to this tab, closed two days ago, whose section is gone.
    agent("ccccccc3", {
      workspaceId: ONE.id,
      createdAt: "2026-10-20T12:00:00.000Z",
      lastUserMessageAt: "2026-10-22T11:00:00.000Z",
      archivedAt: "2026-10-22T11:30:00.000Z",
    }),
    agent("bbbbbbb2", { workspaceId: TWO.id, createdAt: "2026-10-22T09:30:00.000Z", lastUserMessageAt: "2026-10-22T10:00:00.000Z" }),
  ];
  const workspaces = [
    { ...ONE, createdAt: "2026-10-20T10:00:00.000Z" },
    { ...TWO, createdAt: "2026-10-22T09:00:00.000Z" },
  ];
  const options: DisplayOptions = { ...DEFAULT_DISPLAY, workspaceOrder: "latestMessage" };
  const out = renderFolder(planFolder("", agents, workspaces, NOW, options));
  assert.doesNotMatch(out, /ccccccc/);
  assert.deepEqual(groupLines(out), ["# One · 1111111", "# Two · 2222222"]);
});
