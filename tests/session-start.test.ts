import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gitInit, tempDir } from "./helpers.ts";

const HOOK = fileURLToPath(new URL("../claude/session-start.mjs", import.meta.url));

function run(env: Record<string, string>, input = "", hook = HOOK) {
  const result = spawnSync(process.execPath, [hook], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    input,
    encoding: "utf8",
    timeout: 5000,
  });
  return { stdout: result.stdout, status: result.status };
}

function context(stdout: string): string {
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  return parsed.hookSpecificOutput.additionalContext;
}

test("prints nothing outside Paseo", () => {
  assert.deepEqual(run({}), { stdout: "", status: 0 });
});

test("prints nothing outside a git repo", (t) => {
  const dir = join(tempDir(t), "plain");
  mkdirSync(dir);
  assert.deepEqual(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: dir }), { stdout: "", status: 0 });
});

test("prints nothing in a subfolder of a git repo", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const sub = join(repo, "sub");
  mkdirSync(sub);
  assert.deepEqual(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: sub }), { stdout: "", status: 0 });
});

test("prints the rule with the short id and TABS.md path in a git repo", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const { stdout, status } = run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo });

  assert.equal(status, 0);
  const rule = context(stdout);
  assert.match(rule, /· abcdef1`/);
  assert.ok(rule.includes(`${repo}/TABS.md`));
  assert.doesNotMatch(rule, /\{\{/);
});

test("falls back to the hook input's cwd", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const { stdout } = run({ PASEO_AGENT_ID: "abcdef1234" }, JSON.stringify({ cwd: repo, source: "resume" }));

  assert.ok(context(stdout).includes(`${repo}/TABS.md`));
});

test("exits 0 even when rule.md is missing", (t) => {
  const root = tempDir(t);
  const repo = gitInit(join(root, "repo"));
  mkdirSync(join(root, "plugin"));
  const lonely = join(root, "plugin", "session-start.mjs");
  copyFileSync(HOOK, lonely);

  assert.deepEqual(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo }, "", lonely), { stdout: "", status: 0 });
});

test("gives the tab its full agent ID for renaming itself", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo }).stdout);

  assert.match(rule, /update_agent/);
  assert.match(rule, /`abcdef1234-5678`/);
});
