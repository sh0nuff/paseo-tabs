import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { excludeLines, gitInit, makeHome, tempDir, writeAgent } from "./helpers.ts";

const TOOL = fileURLToPath(new URL("../tools/sync-once.ts", import.meta.url));

function run(home: string, ...args: string[]): string {
  return execFileSync(process.execPath, [TOOL, ...args], {
    env: { ...process.env, PASEO_HOME: home },
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
