import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolDefinition } from "@getpaseo/plugin/server";
import { type ArchivedTab, STALE_MS, readRegistry, recordArchived, registryPath, removeArchived } from "../server/archived-tabs.ts";
import { autoArchive, findTabs } from "../server/auto-archive.ts";
import { loadState } from "../server/paseo-state.ts";
import { addItem, finishItem } from "../server/pending-store.ts";
import { pendingTools } from "../server/pending-tools.ts";
import { type ControlRunner, restoreWorkspace } from "../server/workspace-control.ts";
import { makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const STOP = fileURLToPath(new URL("../claude/pending-stop.mjs", import.meta.url));
const REMINDER = fileURLToPath(new URL("../claude/pending-reminder.mjs", import.meta.url));
const PENDING = fileURLToPath(new URL("../tools/pending.ts", import.meta.url));
const CONTROL = fileURLToPath(new URL("../tools/workspace-control.ts", import.meta.url));
const F = { kind: "waiting" as const, what: "Sign in to Plex", action: "a", minutes: 3, why: "w" };
const WS = "wks_1111111aaaaaaa";
const AGENT = "aaaaaaa1-full";
const LINE = "Nothing further waiting on you.";

type T = { after: (fn: () => void) => void };

/** A temp world: state dir with the store and cut-over marker, a Paseo home, a bin dir of fakes, a call log. */
function world(t: T, { archived = false, marker = true } = {}) {
  const root = tempDir(t);
  const state = join(root, "state");
  const dir = join(state, "paseo-tabs", "pending");
  mkdirSync(dir, { recursive: true });
  if (marker) writeFileSync(join(dir, "cutover"), "");
  const home = makeHome(root);
  writeWorkspaces(home, [{ workspaceId: WS, cwd: "/work/one", title: "Phone notes app", archivedAt: archived ? "2026-11-27T10:00:00.000Z" : null }]);
  writeAgent(home, { id: AGENT, cwd: "/work/one", workspaceId: WS, title: "ZenNotes trial" });
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const fake = (name: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
    chmodSync(path, 0o755);
  };
  fake("systemd-run");
  fake("paseo");
  const control = join(root, "fake-control.mjs");
  writeFileSync(control, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, "control " + process.argv.slice(2).join(" ") + "\\n");\n`);
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: join(root, "nohome"),
    XDG_STATE_HOME: state,
    PASEO_HOME: home,
    PASEO_TABS_CONTROL: JSON.stringify([process.execPath, control]),
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  return { root, state, dir, home, env, calls, registry: join(state, "paseo-tabs", "archived-tabs.json") };
}

function hook(script: string, env: Record<string, string>, agent: string | undefined, input: unknown) {
  const e = { ...env };
  if (agent) e.PASEO_AGENT_ID = agent;
  const r = spawnSync(process.execPath, [script], { env: e, input: JSON.stringify(input), encoding: "utf8", timeout: 10_000 });
  return { stdout: r.stdout, status: r.status };
}

function transcript(root: string, finalText: string, name = "t.jsonl") {
  const lines = [
    { type: "user", message: { content: "close it" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__paseo__pending_done", input: { letter: "a" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: finalText }] } },
  ];
  const path = join(root, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

const entry = (ws: string, archivedAt: string, extra: Partial<ArchivedTab> = {}): ArchivedTab => ({
  workspaceId: ws, workspaceName: `name ${ws}`, agentId: `agent-${ws}`, agentTitle: "title", cwd: "/c", archivedAt, ...extra,
});

// Registry

test("registry drops entries older than 30 days on read and on write", (t) => {
  const path = join(tempDir(t), "archived-tabs.json");
  const now = new Date("2026-11-27T12:00:00Z");
  const old = new Date(now.getTime() - STALE_MS - 1000).toISOString();
  const recent = new Date(now.getTime() - STALE_MS + 60_000).toISOString();
  writeFileSync(path, JSON.stringify({ entries: [entry("old", old), entry("recent", recent)] }));
  assert.deepEqual(readRegistry(path, now).map((e) => e.workspaceId), ["recent"]);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).entries.map((e: ArchivedTab) => e.workspaceId), ["recent"]);
  writeFileSync(path, JSON.stringify({ entries: [entry("old", old)] }));
  recordArchived(path, entry("new", now.toISOString()), now);
  assert.deepEqual(readRegistry(path, now).map((e) => e.workspaceId), ["new"]);
});

test("registry replaces an entry for the same workspace and removes on restore", (t) => {
  const path = join(tempDir(t), "archived-tabs.json");
  const now = new Date();
  recordArchived(path, entry("w1", now.toISOString()), now);
  recordArchived(path, entry("w1", now.toISOString(), { agentTitle: "second" }), now);
  recordArchived(path, entry("w2", now.toISOString()), now);
  assert.deepEqual(readRegistry(path, now).map((e) => [e.workspaceId, e.agentTitle]), [["w1", "second"], ["w2", "title"]]);
  assert.equal(removeArchived(path, ["w1"], now), 1);
  assert.equal(removeArchived(path, ["nope"], now), 0);
  assert.deepEqual(readRegistry(path, now).map((e) => e.workspaceId), ["w2"]);
});

test("the restore CLI restores a recoverable workspace and drops its registry entry", (t) => {
  const w = world(t, { archived: true });
  const now = new Date();
  recordArchived(w.registry, entry(WS, now.toISOString()), now);
  // A fake Paseo client library, so the real CLI code runs against no daemon.
  const cli = join(w.root, "fake-cli");
  mkdirSync(join(cli, "dist", "utils"), { recursive: true });
  const log = join(w.root, "client.log");
  writeFileSync(
    join(cli, "dist", "utils", "client.js"),
    `import { appendFileSync } from "node:fs";
export async function connectToDaemon() {
  return {
    inspectWorkspaceRecovery: async (id) => { appendFileSync(${JSON.stringify(log)}, "inspect " + id + "\\n"); return { kind: process.env.FAKE_KIND, reason: "active" }; },
    restoreWorkspace: async (id) => { appendFileSync(${JSON.stringify(log)}, "restore " + id + "\\n"); },
    close: async () => {},
  };
}\n`,
  );
  writeFileSync(join(cli, "dist", "utils", "daemon-target.js"), "export function selectDaemonTarget() { return {}; }\n");
  const run = (kind: string) =>
    spawnSync(process.execPath, [CONTROL, "restore", WS], { env: { ...w.env, PASEO_CLI_ROOT: cli, FAKE_KIND: kind }, encoding: "utf8" });
  const r = run("recoverable");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /restored, registry entry removed/);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [`inspect ${WS}`, `restore ${WS}`]);
  assert.deepEqual(readRegistry(w.registry, now), []);
  const again = run("unavailable");
  assert.match(again.stdout, /not restored: active/);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 3);
});

test("restoreWorkspace restores only what Paseo calls recoverable", async () => {
  const done: string[] = [];
  const runner = (kind: string): ControlRunner => ({
    inspect: async () => ({ kind, reason: "not archived" }),
    restore: async (id) => void done.push(id),
    archive: async () => {},
    agentStatus: async () => "idle",
  });
  assert.equal(await restoreWorkspace("w", runner("recoverable")), "restored");
  assert.equal(await restoreWorkspace("x", runner("unavailable")), "not restored: not archived");
  assert.deepEqual(done, ["w"]);
});

// Stop hook

function closedItem(w: ReturnType<typeof world>, agent = AGENT, ws = WS) {
  addItem(w.dir, ws, "/c", agent, F, new Date());
  finishItem(w.dir, ws, agent, "a", "done", null, new Date());
}

const BLOCK_LINE = /"decision":"block","reason":"All pending items are closed\. End your reply with the line: Nothing further waiting on you\./;

test("stop hook asks for the line once, then schedules the archive when the line is there", (t) => {
  const w = world(t);
  closedItem(w);
  const without = hook(STOP, w.env, AGENT, { transcript_path: transcript(w.root, "All done.") });
  assert.equal(without.status, 0);
  assert.match(without.stdout, BLOCK_LINE);
  assert.deepEqual(w.calls(), []);
  const withLine = hook(STOP, w.env, AGENT, { transcript_path: transcript(w.root, `All done.\n\n${LINE}`, "u.jsonl") });
  assert.equal(withLine.stdout, "");
  const calls = w.calls();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^systemd-run --user --quiet --collect --on-active=90 --unit=paseo-tabs-archive-aaaaaaa1 /);
  assert.match(calls[0], /tools\/pending\.ts auto-archive --agent aaaaaaa1-full$/);
  // Handled: the next turn end does nothing until another item closes.
  assert.equal(hook(STOP, w.env, AGENT, { transcript_path: transcript(w.root, "Hi.", "v.jsonl") }).stdout, "");
  assert.equal(w.calls().length, 1);
});

test("stop hook schedules on stop_hook_active even without the line, and reads last_assistant_message", (t) => {
  const a = world(t);
  closedItem(a);
  assert.equal(hook(STOP, a.env, AGENT, { transcript_path: transcript(a.root, "x"), stop_hook_active: true }).stdout, "");
  assert.equal(a.calls().length, 1);
  const b = world(t);
  closedItem(b);
  assert.equal(hook(STOP, b.env, AGENT, { transcript_path: transcript(b.root, "x"), last_assistant_message: LINE }).stdout, "");
  assert.equal(b.calls().length, 1);
});

test("stop hook does nothing with open items, no items ever, a sibling's open item, or no marker", (t) => {
  const open = world(t);
  addItem(open.dir, WS, "/c", AGENT, F, new Date());
  assert.equal(hook(STOP, open.env, AGENT, { transcript_path: transcript(open.root, LINE) }).stdout, "");
  const never = world(t);
  closedItem(never, "someone-else");
  assert.equal(hook(STOP, never.env, AGENT, { transcript_path: transcript(never.root, LINE) }).stdout, "");
  const sibling = world(t);
  closedItem(sibling);
  addItem(sibling.dir, WS, "/c", "bbbbbbb2-sibling", F, new Date());
  assert.equal(hook(STOP, sibling.env, AGENT, { transcript_path: transcript(sibling.root, LINE) }).stdout, "");
  const off = world(t, { marker: false });
  closedItem(off);
  assert.equal(hook(STOP, off.env, AGENT, { transcript_path: transcript(off.root, LINE) }).stdout, "");
  assert.equal(hook(STOP, open.env, undefined, { transcript_path: transcript(open.root, LINE) }).stdout, "");
  for (const w of [open, never, sibling, off]) assert.deepEqual(w.calls(), []);
});

// The scheduled run

function runner(status: Record<string, string>, archived: string[]): ControlRunner {
  return {
    inspect: async () => ({ kind: "unavailable" }),
    restore: async () => {},
    archive: async (id) => void archived.push(id),
    agentStatus: async (id) => status[id] ?? null,
  };
}

test("auto-archive archives an idle workspace with nothing open and records it", async (t) => {
  const w = world(t);
  closedItem(w);
  const archived: string[] = [];
  const now = new Date("2026-11-27T12:00:00Z");
  const line = await autoArchive({ agentId: AGENT, dir: w.dir, home: w.home, registry: w.registry, runner: runner({ [AGENT]: "idle" }, archived), now });
  assert.match(line, /archived \("Phone notes app", tab aaaaaaa1-full\)/);
  assert.deepEqual(archived, [WS]);
  assert.deepEqual(readRegistry(w.registry, now), [
    { workspaceId: WS, workspaceName: "Phone notes app", agentId: AGENT, agentTitle: "ZenNotes trial", cwd: "/work/one", archivedAt: now.toISOString() },
  ]);
});

test("auto-archive re-checks: a new open item, a running tab, or an archived workspace stops it", async (t) => {
  const w = world(t);
  closedItem(w);
  addItem(w.dir, WS, "/c", AGENT, F, new Date());
  const archived: string[] = [];
  const args = { agentId: AGENT, dir: w.dir, home: w.home, registry: w.registry, now: new Date() };
  assert.match(await autoArchive({ ...args, runner: runner({ [AGENT]: "idle" }, archived) }), /1 open item\(s\), not archived/);
  const r = world(t);
  closedItem(r);
  assert.match(
    await autoArchive({ ...args, dir: r.dir, home: r.home, registry: r.registry, runner: runner({ [AGENT]: "running" }, archived) }),
    /is running, not archived/,
  );
  writeAgent(r.home, { id: "ccccccc3-other", cwd: "/work/one", workspaceId: WS });
  assert.match(
    await autoArchive({ ...args, dir: r.dir, home: r.home, registry: r.registry, runner: runner({ [AGENT]: "idle" }, archived) }),
    /tab ccccccc3-other is unknown, not archived/,
  );
  const gone = world(t, { archived: true });
  closedItem(gone);
  assert.match(
    await autoArchive({ ...args, dir: gone.dir, home: gone.home, registry: gone.registry, runner: runner({ [AGENT]: "idle" }, archived) }),
    /already archived/,
  );
  assert.deepEqual(archived, []);
  assert.equal(existsSync(w.registry) || existsSync(r.registry), false);
});

test("the auto-archive CLI checks the status through paseo and archives through it", (t) => {
  const w = world(t);
  closedItem(w);
  // A fake paseo that reports idle and records the archive.
  writeFileSync(
    join(w.root, "bin", "paseo"),
    `#!/bin/sh\necho "paseo $*" >> "${join(w.root, "calls.log")}"\nif [ "$1" = agent ]; then echo '{"Status":"idle"}'; fi\n`,
  );
  const r = spawnSync(process.execPath, [PENDING, "auto-archive", "--agent", AGENT], { env: w.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /archived/);
  assert.deepEqual(w.calls(), [`paseo agent inspect ${AGENT} --json`, `paseo workspace archive ${WS}`]);
  assert.equal(readRegistry(w.registry, new Date()).length, 1);
});

// Coming back

test("the reminder never restores an archived workspace", (t) => {
  const w = world(t, { archived: true });
  assert.equal(hook(REMINDER, w.env, AGENT, {}).status, 0);
  assert.deepEqual(w.calls(), []);
});

test("stop hook schedules nothing when the workspace is already archived", (t) => {
  const w = world(t, { archived: true });
  closedItem(w);
  assert.equal(hook(STOP, w.env, AGENT, { transcript_path: transcript(w.root, "x") }).stdout, "");
  assert.equal(hook(STOP, w.env, AGENT, { transcript_path: transcript(w.root, LINE), stop_hook_active: true }).stdout, "");
  assert.deepEqual(w.calls(), []);
});

test("adding a waiting item for an archived tab restores its workspace, a next item does not", async (t) => {
  const w = world(t, { archived: true });
  const next = spawnSync(process.execPath, [PENDING, "add", "--agent", AGENT, "--json", JSON.stringify({ ...F, kind: "next" }), "--dir", w.dir, "--home", w.home], { env: w.env, encoding: "utf8" });
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(w.calls(), []);
  const r = spawnSync(process.execPath, [PENDING, "add", "--agent", AGENT, "--json", JSON.stringify(F), "--dir", w.dir, "--home", w.home], { env: w.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).letter, "b");
  assert.deepEqual(w.calls(), [`control restore ${WS}`]);

  const restored: string[] = [];
  const tool = pendingTools(w.dir, { home: w.home, registry: w.registry, restore: (id) => void restored.push(id) }).find((x) => x.name === "pending_add") as AgentToolDefinition;
  const exec = (tool as never as { execute: (i: unknown, c: unknown) => Promise<{ text: string }> }).execute;
  const ctx = (ws: string) => ({ agent: { id: AGENT, workspaceId: ws, cwd: "/c" }, signal: new AbortController().signal });
  assert.doesNotMatch((await exec({ ...F, kind: "next" }, ctx(WS))).text, /restored/);
  assert.deepEqual(restored, []);
  const out = await exec(F, ctx(WS));
  assert.match(out.text, /being restored/);
  await exec(F, ctx("wks_live_elsewhere"));
  assert.deepEqual(restored, [WS]);
});

// Finding tabs

test("find matches live and archived tabs by name words and id prefix, and drops revived entries", (t) => {
  const w = world(t);
  const now = new Date();
  recordArchived(w.registry, entry("wks_archived1", now.toISOString(), { workspaceName: "Kitchen tablet", agentTitle: "Kiosk page", agentId: "ddddddd4-x" }), now);
  recordArchived(w.registry, entry(WS, now.toISOString()), now); // live again in Paseo
  const state = loadState(w.home);
  assert.deepEqual(findTabs(state, w.registry, "phone zennotes", now).map((r) => [r.agentId, r.archived]), [[AGENT, false]]);
  assert.deepEqual(findTabs(state, w.registry, "kitchen", now).map((r) => [r.workspaceId, r.archived]), [["wks_archived1", true]]);
  assert.deepEqual(findTabs(state, w.registry, "ddddddd", now).map((r) => r.agentTitle), ["Kiosk page"]);
  assert.deepEqual(findTabs(state, w.registry, "aaaaaaa1", now).map((r) => r.workspaceName), ["Phone notes app"]);
  assert.deepEqual(findTabs(state, w.registry, "kitchen phone", now), []);
  assert.deepEqual(readRegistry(w.registry, now).map((e) => e.workspaceId), ["wks_archived1"]);

  const cli = spawnSync(process.execPath, [PENDING, "find", "kiosk", "--home", w.home], { env: w.env, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const rows = cli.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.workspaceId, r.workspaceName, r.agentId, r.archived]), [["wks_archived1", "Kitchen tablet", "ddddddd4-x", true]]);
  assert.equal(registryPath(w.env), w.registry);
});

test("pending_find answers with JSON lines", async (t) => {
  const w = world(t);
  const tool = pendingTools(w.dir, { home: w.home, registry: w.registry, restore: () => {} }).find((x) => x.name === "pending_find")!;
  const exec = (tool as never as { execute: (i: unknown, c: unknown) => Promise<{ text: string }> }).execute;
  const out = await exec({ query: "notes" }, {});
  assert.equal(JSON.parse(out.text).agentTitle, "ZenNotes trial");
  assert.equal((await exec({ query: "nothing-like-it" }, {})).text, "No matching tabs.");
});
