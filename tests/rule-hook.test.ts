import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ruleHook } from "../server/rule-hook.ts";
import { buildRule, RULE_APPENDED_ENV } from "../lib/rules.mjs";
import { gitInit, tempDir } from "./helpers.ts";

type Request = { agentId: string; cwd: string; provider: string; purpose: "interactive" | "history"; appendSystemPrompt?: string[]; env: Record<string, string> };

function request(cwd: string, provider = "codex", purpose: "interactive" | "history" = "interactive"): Request {
  return { agentId: "abcdef1234-5678", cwd, provider, purpose, env: { OTHER: "kept" } };
}

const hookFor = (state: string) =>
  ruleHook((agentId, cwd) => buildRule({ agentId, cwd, env: { HOME: state, XDG_STATE_HOME: state, PASEO_HOME: join(state, "no-paseo") }, fallbackRoot: "/plugin" }));

test("a codex tab gets the pending rule in its system prompt, with its ids filled, and the env flag", async (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const out = await hookFor(tempDir(t))({ request: request(repo) });
  assert.ok(out);
  assert.equal(out.appendSystemPrompt?.length, 1);
  const rule = out.appendSystemPrompt![0];
  assert.match(rule, /pending_add/);
  assert.match(rule, /`abcdef1234-5678`/);
  assert.ok(rule.includes("node /plugin/tools/pending.ts add --agent"));
  assert.doesNotMatch(rule, /\{\{/);
  assert.doesNotMatch(rule, /archived by itself/);
  assert.deepEqual(out.env, { OTHER: "kept", [RULE_APPENDED_ENV]: "1" });
});

test("the rule keeps earlier instructions and carries the archive wording when auto-archive is on", async (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const state = tempDir(t);
  const hook = ruleHook((agentId, cwd) =>
    buildRule({ agentId, cwd, env: { HOME: state, XDG_STATE_HOME: state, PASEO_HOME: join(state, "none") }, saved: { autoArchive: true }, fallbackRoot: "/plugin" }),
  );
  const out = await hook({ request: { ...request(repo, "claude"), appendSystemPrompt: ["Earlier."] } });
  assert.equal(out?.appendSystemPrompt?.[0], "Earlier.");
  assert.match(out!.appendSystemPrompt![1], /archived by itself about 10 minutes later/);
});

test("no rule outside a repo's top level, nor for history opens", async (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const hook = hookFor(tempDir(t));
  assert.equal(await hook({ request: request(join(repo, "missing")) }), undefined);
  assert.equal(await hook({ request: request(tempDir(t)) }), undefined);
  assert.equal(await hook({ request: request(repo, "codex", "history") }), undefined);
});

test("a rule that cannot be built leaves the open alone instead of failing it", async (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const hook = ruleHook(() => {
    throw new Error("broken");
  });
  const original = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = original;
  });
  assert.equal(await hook({ request: request(repo) }), undefined);
});
