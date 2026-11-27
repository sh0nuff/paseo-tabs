import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addItem } from "../server/pending-store.ts";
import { tempDir } from "./helpers.ts";

const REMINDER = fileURLToPath(new URL("../claude/pending-reminder.mjs", import.meta.url));
const STOP = fileURLToPath(new URL("../claude/pending-stop.mjs", import.meta.url));
const F = { kind: "waiting" as const, what: "Sign in to the dashboard", action: "a", minutes: 3, why: "w" };

function setup(t: { after: (fn: () => void) => void }, marker = true) {
  const state = tempDir(t);
  const dir = join(state, "paseo-tabs", "pending");
  mkdirSync(dir, { recursive: true });
  if (marker) writeFileSync(join(dir, "cutover"), "");
  // Without the marker, a 1.x item clock makes it a legacy install in mode tabs-md.
  else writeFileSync(join(state, "paseo-tabs", "items-0123abcd.json"), "{}");
  return { state, dir };
}

function run(script: string, state: string, agent: string | undefined, input = "") {
  // A temp Paseo home and a PATH with no paseo or systemd-run, so nothing real is read or run.
  const env: Record<string, string> = { PATH: dirname(process.execPath), HOME: join(state, "no-home"), PASEO_HOME: join(state, "no-paseo"), XDG_STATE_HOME: state };
  if (agent) env.PASEO_AGENT_ID = agent;
  const r = spawnSync(process.execPath, [script], { env, input, encoding: "utf8", timeout: 5000 });
  return { stdout: r.stdout, status: r.status };
}

test("reminder lists this agent's open items only", (t) => {
  const { state, dir } = setup(t);
  addItem(dir, "w", "/c", "A", F, new Date());
  addItem(dir, "w", "/c", "A", { ...F, kind: "next", what: "Own step" }, new Date());
  addItem(dir, "w", "/c", "B", { ...F, what: "Not mine" }, new Date());
  const { stdout, status } = run(REMINDER, state, "A");
  assert.equal(status, 0);
  const out = JSON.parse(stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "UserPromptSubmit");
  assert.match(out.additionalContext, /a\) Sign in to the dashboard \(about 3 min\)/);
  assert.match(out.additionalContext, /Own step/);
  assert.doesNotMatch(out.additionalContext, /Not mine/);
  assert.match(out.additionalContext, /Never add an item you can check yourself\.$/);
});

test("reminder prints nothing in a 1.x install without marker, or without agent id or open items", (t) => {
  const a = setup(t, false);
  addItem(a.dir, "w", "/c", "A", F, new Date());
  assert.equal(run(REMINDER, a.state, "A").stdout, "");
  const b = setup(t);
  addItem(b.dir, "w", "/c", "A", F, new Date());
  assert.equal(run(REMINDER, b.state, undefined).stdout, "");
  assert.equal(run(REMINDER, b.state, "Z").stdout, "");
});

function transcript(dir: string, tools: unknown[], name = "t.jsonl") {
  const lines = [
    { type: "user", message: { content: "old" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pending_" } }] } },
    { type: "user", message: { content: "do it" } },
    ...tools.map((b) => ({ type: "assistant", message: { content: [b] } })),
    { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
  ];
  const path = join(dir, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

const bash = (command: string) => ({ type: "tool_use", name: "Bash", input: { command } });
const three = [bash("ls"), bash("pwd"), bash("date")];
const BLOCK = /^\{"decision":"block","reason":"Before you end this turn, reconcile/;

test("stop hook blocks after 3 tool uses with open items and no pending tool", (t) => {
  const { state, dir } = setup(t);
  addItem(dir, "w", "/c", "A", F, new Date());
  const path = transcript(state, three);
  const r = run(STOP, state, "A", JSON.stringify({ transcript_path: path }));
  assert.equal(r.status, 0);
  assert.match(r.stdout, BLOCK);
});

test("stop hook stays quiet when active, short, reconciled, or nothing is open", (t) => {
  const { state, dir } = setup(t);
  addItem(dir, "w", "/c", "A", F, new Date());
  const ok = transcript(state, three);
  assert.equal(run(STOP, state, "A", JSON.stringify({ transcript_path: ok, stop_hook_active: true })).stdout, "");
  assert.equal(run(STOP, state, "A", JSON.stringify({ transcript_path: transcript(state, three.slice(0, 2), "s.jsonl") })).stdout, "");
  const mcp = transcript(state, [...three, { type: "tool_use", name: "mcp__paseo__pending_list", input: {} }], "m.jsonl");
  assert.equal(run(STOP, state, "A", JSON.stringify({ transcript_path: mcp })).stdout, "");
  const cli = transcript(state, [...three, bash("node /opt/paseo-tabs/tools/pending.ts list --agent A")], "c.jsonl");
  assert.equal(run(STOP, state, "A", JSON.stringify({ transcript_path: cli })).stdout, "");
  assert.equal(run(STOP, state, "B", JSON.stringify({ transcript_path: ok })).stdout, "");
  assert.equal(run(STOP, state, "A", "not json").stdout, "");
});
