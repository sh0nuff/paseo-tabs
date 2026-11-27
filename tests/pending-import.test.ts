import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";
import { importTabs } from "../tools/pending-import.ts";
import { importFiles, readPending } from "../server/pending-store.ts";
import { addItem } from "../server/pending-store.ts";
import { loadState } from "../server/paseo-state.ts";

const TOOL = fileURLToPath(new URL("../tools/pending-import.ts", import.meta.url));
const NOW = new Date("2026-11-26T12:00:00.000Z");
const WS = "wks_1111111aaaaaaa";

const TABS = `# Review Focus · 1111111

## 🟠 1. Review Focus 4 · aaaaaaa

### About this tab
Something.

**Waiting on you**
- a) [ ] Pick a name (about 10 min) (Tasks task e0eed4e9-8790-48c2-ad99-1948e7cc306c)
- b) [ ] Reply to the thing

**Claude's next steps**
- c) [ ] Build it (about 3 min)

**Done**
- d) [x] ~~Old thing~~ (done by hand)
- z) [x] Finished plain
\`\`\`
- q) [ ] inside a fence
\`\`\`

## 🔵 2. Second · bbbbbbb

**Waiting on you**
- a) [ ] Other tab item (about 5 min)

## 3. Ghost · ccccccc

**Waiting on you**
- a) [ ] Nobody owns this
`;

function setup(t: { after: (fn: () => void) => void }) {
  const root = tempDir(t);
  const home = makeHome(root);
  writeWorkspaces(home, [{ workspaceId: WS, cwd: "/repo", title: "Review Focus" }]);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: "/repo/sub", workspaceId: WS });
  writeAgent(home, { id: "bbbbbbb2-full", cwd: "/repo", workspaceId: WS });
  return { root, home, state: loadState(home) };
}

test("imports both tabs of a workspace with their letters", (t) => {
  const { state } = setup(t);
  const files = importTabs(TABS, state, NOW);
  assert.equal(files.length, 1);
  const f = files[0];
  assert.equal(f.workspaceId, WS);
  assert.equal(f.cwd, "/repo");
  const a = f.items.filter((i) => i.agentId === "aaaaaaa1-full");
  assert.deepEqual(a.map((i) => [i.letter, i.kind, i.status]), [
    ["a", "waiting", "open"], ["b", "waiting", "open"], ["c", "next", "open"], ["d", "waiting", "done"], ["z", "waiting", "done"],
  ]);
  assert.equal(a[0].what, "Pick a name");
  assert.equal(a[0].minutes, 10);
  assert.equal(a[0].linkedTask, "e0eed4e9-8790-48c2-ad99-1948e7cc306c");
  assert.equal(a[1].minutes, 0);
  assert.equal(a[1].action, "");
  assert.equal(a[3].what, "Old thing");
  assert.ok(a[3].done);
  assert.equal(f.items.filter((i) => i.agentId === "bbbbbbb2-full").length, 1);
  assert.equal(f.highest["aaaaaaa1-full"], "z");
});

test("a re-run adds nothing and a done z makes the next add aa", (t) => {
  const { state, root } = setup(t);
  const dir = join(root, "store");
  importFiles(dir, importTabs(TABS, state, NOW));
  const before = readPending(dir, WS).items.length;
  importFiles(dir, importTabs(TABS, state, NOW));
  assert.equal(readPending(dir, WS).items.length, before);
  const item = addItem(dir, WS, "/repo", "aaaaaaa1-full", { kind: "waiting", what: "x", action: "y", minutes: 1, why: "z" }, NOW);
  assert.equal(item.letter, "aa");
});

test("CLI dry run reports and writes nothing; --write imports", (t) => {
  const { root, home } = setup(t);
  const dir = join(root, "store");
  const file = join(root, "TABS.md");
  writeFileSync(file, TABS);
  const run = (...a: string[]) => execFileSync(process.execPath, [TOOL, file, "--dir", dir, "--home", home, ...a], { encoding: "utf8" });
  const out = run();
  assert.match(out, /^1111111 \/repo: 3 waiting, 1 next, 2 done, 1 unmatched sections$/m);
  assert.throws(() => readdirSync(dir));
  run("--write");
  assert.equal(readPending(dir, WS).items.length, 6);
});
