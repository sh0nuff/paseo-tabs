import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordActivity } from "../server/activity.ts";
import { readRegistry } from "../server/archived-tabs.ts";
import { autoArchive } from "../server/auto-archive.ts";
import { addItem, finishItem } from "../server/pending-store.ts";
import { type Timers, startSweeper, sweep } from "../server/sweep.ts";
import type { ControlRunner } from "../server/workspace-control.ts";
import { makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const PENDING = fileURLToPath(new URL("../tools/pending.ts", import.meta.url));
const NOW = new Date("2026-11-27T12:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number, from = NOW) => new Date(from.getTime() - ms);
const WS = "wks_1111111aaaaaaa";
const AGENT = "aaaaaaa1-full";
const F = { kind: "waiting" as const, what: "Sign in to Plex", action: "a", minutes: 3, why: "w" };

type T = { after: (fn: () => void) => void };

/** A finished, quiet workspace: one closed item an hour old, one idle tab last touched an hour ago. */
function world(t: T, { now = NOW, pinned = false } = {}) {
  const root = tempDir(t);
  const state = join(root, "state");
  const dir = join(state, "paseo-tabs", "pending");
  mkdirSync(dir, { recursive: true });
  const home = makeHome(root);
  writeWorkspaces(home, [{ workspaceId: WS, cwd: "/work/one", title: "Phone notes app", pinnedAt: pinned ? "2026-11-01T00:00:00.000Z" : null }]);
  writeAgent(home, { id: AGENT, cwd: "/work/one", workspaceId: WS, title: "ZenNotes trial", updatedAt: ago(60 * MIN, now).toISOString() });
  return { root, state, dir, home, registry: join(state, "paseo-tabs", "archived-tabs.json") };
}

function closedItem(w: ReturnType<typeof world>, at = ago(60 * MIN), agent = AGENT) {
  addItem(w.dir, WS, "/c", agent, F, at);
  finishItem(w.dir, WS, agent, "a", "done", null, at);
}

function runner(status: Record<string, string>, archived: string[]): ControlRunner {
  return {
    inspect: async () => ({ kind: "unavailable" }),
    restore: async () => {},
    archive: async (id) => void archived.push(id),
    agentStatus: async (id) => status[id] ?? null,
  };
}

function schedule(home: string, id: string, status: string, agentId = AGENT) {
  mkdirSync(join(home, "schedules"), { recursive: true });
  writeFileSync(join(home, "schedules", `${id}.json`), JSON.stringify({ id, name: `Beat ${id}`, status, target: { type: "agent", agentId } }));
}

async function run(w: ReturnType<typeof world>, status: Record<string, string> = { [AGENT]: "idle" }, dryRun = false) {
  const archived: string[] = [];
  const decisions = await sweep({ home: w.home, dir: w.dir, registry: w.registry, runner: runner(status, archived), now: NOW, dryRun });
  return { archived, decisions, reason: decisions.find((d) => d.workspaceId === WS)?.reason ?? "(none)" };
}

test("sweep archives a finished, quiet, idle workspace and records its tabs", async (t) => {
  const w = world(t);
  closedItem(w);
  const r = await run(w);
  assert.deepEqual(r.archived, [WS]);
  assert.deepEqual(r.decisions, [{ workspaceId: WS, name: "Phone notes app", action: "archive", reason: "archived" }]);
  assert.deepEqual(readRegistry(w.registry, NOW).map((e) => [e.agentId, e.workspaceName]), [[AGENT, "Phone notes app"]]);
});

test("sweep leaves a workspace with an open item", async (t) => {
  const w = world(t);
  addItem(w.dir, WS, "/c", AGENT, { ...F, kind: "next" }, ago(60 * MIN));
  const r = await run(w);
  assert.deepEqual(r.archived, []);
  assert.equal(r.reason, "1 open item(s)");
});

test("sweep leaves a workspace that never had items", async (t) => {
  const w = world(t);
  const r = await run(w);
  assert.deepEqual(r.archived, []);
  assert.equal(r.reason, "never had items");
});

test("sweep leaves a workspace whose tab is running or of unknown status", async (t) => {
  const w = world(t);
  closedItem(w);
  assert.match((await run(w, { [AGENT]: "running" })).reason, /aaaaaaa1-full is running/);
  assert.match((await run(w, {})).reason, /aaaaaaa1-full is unknown/);
});

test("a running subagent started from the workspace's tab keeps it open, an archived one does not", async (t) => {
  const w = world(t);
  closedItem(w);
  writeAgent(w.home, { id: "sub00001", cwd: "/elsewhere", workspaceId: "wks_other", updatedAt: ago(60 * MIN).toISOString(), labels: { "paseo.parent-agent-id": AGENT } });
  assert.match((await run(w, { [AGENT]: "idle", sub00001: "running" })).reason, /sub00001 is running/);
  writeAgent(w.home, { id: "sub00001", cwd: "/elsewhere", workspaceId: "wks_other", archivedAt: ago(30 * MIN).toISOString(), labels: { "paseo.parent-agent-id": AGENT } });
  assert.deepEqual((await run(w, { [AGENT]: "idle" })).archived, [WS]);
});

test("sweep waits 10 minutes after any activity: agent record, item change, message box", async (t) => {
  const recent = ago(4 * MIN).toISOString();
  const a = world(t);
  closedItem(a);
  writeAgent(a.home, { id: AGENT, cwd: "/work/one", workspaceId: WS, updatedAt: ago(60 * MIN).toISOString(), lastUserMessageAt: recent });
  assert.match((await run(a)).reason, /activity 4 minute/);
  writeAgent(a.home, { id: AGENT, cwd: "/work/one", workspaceId: WS, updatedAt: recent });
  assert.match((await run(a)).reason, /activity 4 minute/);
  writeAgent(a.home, { id: AGENT, cwd: "/work/one", workspaceId: WS, updatedAt: ago(11 * MIN).toISOString() });
  assert.deepEqual((await run(a)).archived, [WS]);

  const b = world(t);
  closedItem(b, ago(8 * MIN));
  assert.match((await run(b)).reason, /activity 8 minute/);

  const c = world(t);
  closedItem(c);
  recordActivity(c.dir, AGENT, 0, ago(9 * MIN));
  assert.match((await run(c)).reason, /activity 9 minute/);
});

test("sweep leaves a workspace with a recent unsent draft", async (t) => {
  const w = world(t);
  closedItem(w);
  recordActivity(w.dir, AGENT, 12, ago(2 * MIN));
  assert.match((await run(w)).reason, /unsent text/);
});

test("sweep leaves everything while voice dictation was recent", async (t) => {
  const w = world(t);
  closedItem(w);
  writeFileSync(join(w.home, "daemon.log"), `${JSON.stringify({ time: ago(3 * MIN).getTime(), msg: "ws_runtime_metrics", top: [{ type: "dictation_stream_chunk" }] })}\n`);
  assert.match((await run(w)).reason, /voice dictation/);
});

test("an active or paused schedule on a tab exempts the workspace; completed or expired ones do not", async (t) => {
  for (const status of ["active", "paused"]) {
    const w = world(t);
    closedItem(w);
    schedule(w.home, "beat1", status);
    const r = await run(w);
    assert.deepEqual(r.archived, [], status);
    assert.equal(r.reason, `schedule "Beat beat1" targets tab ${AGENT}`);
  }
  const w = world(t);
  closedItem(w);
  schedule(w.home, "old1", "completed");
  schedule(w.home, "old2", "expired");
  schedule(w.home, "other", "active", "someone-else");
  assert.deepEqual((await run(w)).archived, [WS]);
});

test("a pinned workspace is exempt", async (t) => {
  const w = world(t, { pinned: true });
  closedItem(w);
  const r = await run(w);
  assert.deepEqual(r.archived, []);
  assert.equal(r.reason, "pinned");
});

test("a dry run reports what it would archive and archives and records nothing", async (t) => {
  const w = world(t);
  closedItem(w);
  const r = await run(w, { [AGENT]: "idle" }, true);
  assert.deepEqual(r.archived, []);
  assert.deepEqual(r.decisions, [{ workspaceId: WS, name: "Phone notes app", action: "archive", reason: "would archive (dry run)" }]);
  assert.equal(existsSync(w.registry), false);
});

test("pending.ts sweep --dry-run prints every live workspace's decision and never archives", (t) => {
  const now = new Date();
  const w = world(t, { now });
  closedItem(w, ago(60 * MIN, now));
  writeWorkspaces(w.home, [
    { workspaceId: WS, cwd: "/work/one", title: "Phone notes app" },
    { workspaceId: "wks_2222222bbbbbbb", cwd: "/work/two", title: "Second" },
    { workspaceId: "wks_3333333ccccccc", cwd: "/work/three", title: "Gone", archivedAt: "2026-11-01T00:00:00.000Z" },
  ]);
  const bin = join(w.root, "bin");
  mkdirSync(bin);
  const log = join(w.root, "calls.log");
  writeFileSync(join(bin, "paseo"), `#!/bin/sh\necho "paseo $*" >> "${log}"\necho '{"Status":"idle"}'\n`);
  chmodSync(join(bin, "paseo"), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: join(w.root, "nohome"), XDG_STATE_HOME: w.state, PASEO_HOME: w.home };
  const r = spawnSync(process.execPath, [PENDING, "sweep", "--dry-run"], { env, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), [`archive  ${WS} "Phone notes app"`, `skip: never had items  wks_2222222bbbbbbb "Second"`]);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [`paseo agent inspect ${AGENT} --json`]);
  assert.equal(existsSync(w.registry), false);
  const refused = spawnSync(process.execPath, [PENDING, "sweep"], { env, encoding: "utf8", timeout: 20_000 });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /only runs with --dry-run/);
});

test("the sweeper skips a tick while the last sweep runs, and stops", async () => {
  let fire: () => void = () => {};
  let cleared = false;
  const timers: Timers = {
    setInterval: (fn, ms) => {
      assert.equal(ms, 5 * MIN);
      fire = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  };
  let runs = 0;
  let release: () => void = () => {};
  const sweeper = startSweeper(() => {
    runs++;
    return new Promise<void>((resolve) => (release = resolve));
  }, 5 * MIN, timers);
  const first = sweeper.tick();
  fire();
  assert.equal(await sweeper.tick(), false, "a tick during a sweep is skipped");
  assert.equal(runs, 1);
  release();
  assert.equal(await first, true);
  fire();
  assert.equal(runs, 2);
  release();
  await new Promise((r) => setImmediate(r));
  sweeper.stop();
  assert.equal(cleared, true);
  assert.equal(await sweeper.tick(), false, "nothing runs after stop");
  assert.equal(runs, 2);
});

test("the Stop hook's scheduled auto-archive honours schedules and pins too", async (t) => {
  const a = world(t);
  closedItem(a);
  schedule(a.home, "beat1", "active");
  const archived: string[] = [];
  const base = { agentId: AGENT, registry: a.registry, runner: runner({ [AGENT]: "idle" }, archived), now: NOW };
  assert.match(await autoArchive({ ...base, dir: a.dir, home: a.home }), /schedule "Beat beat1" targets tab .*not archived/);
  const b = world(t, { pinned: true });
  closedItem(b);
  assert.match(await autoArchive({ ...base, dir: b.dir, home: b.home, registry: b.registry }), /pinned, not archived/);
  assert.deepEqual(archived, []);
});
