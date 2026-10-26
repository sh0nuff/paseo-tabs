import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { excludeLines, gitInit, makeHome, tempDir, writeAgent } from "./helpers.ts";
import { clockPath } from "../server/item-clock.ts";

const TOOL = fileURLToPath(new URL("../tools/sync-once.ts", import.meta.url));

function run(home: string, ...args: string[]): string {
  return execFileSync(process.execPath, [TOOL, ...args], {
    env: { ...process.env, PASEO_HOME: home, XDG_STATE_HOME: join(home, "..", "state") },
    encoding: "utf8",
  });
}

test("sync-once --dry-run prints the change and writes nothing", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });

  const out = run(home, "--dry-run");

  assert.match(out, /^\+## 1\. A title · aaaaaaa$/m);
  assert.match(out, new RegExp(`^${repo}: created$`, "m"));
  assert.equal(existsSync(join(repo, "TABS.md")), false);
  assert.deepEqual(excludeLines(repo), []);
});

test("sync-once without --dry-run writes the files", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });

  const out = run(home);

  assert.match(out, new RegExp(`^${repo}: created$`, "m"));
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);
  assert.deepEqual(excludeLines(repo), ["TABS.md"]);
});

test("sync-once respects the clock and never changes it", (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1", cwd: repo });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n");
  const path = clockPath({ XDG_STATE_HOME: join(root, "state") }, home);
  mkdirSync(join(root, "state", "paseo-tabs"), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, items: { "aaaaaaa:a": { text: "answer", since: "2020-01-01T00:00:00.000Z" } } }));
  const before = statSync(path).mtimeMs;

  run(home);

  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🔴 1\. A title · aaaaaaa$/m);
  assert.equal(statSync(path).mtimeMs, before);
});
