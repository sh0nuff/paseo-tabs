import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activityPath, pendingActivityHandler, readActivity, recentDictation } from "../server/activity.ts";
import { MAX_POSTPONEMENTS, autoArchive } from "../server/auto-archive.ts";
import { addItem, finishItem } from "../server/pending-store.ts";
import type { ControlRunner } from "../server/workspace-control.ts";
import { DraftThrottle } from "../client/draft-throttle.ts";
import { pendingActivity } from "../shared/activity-rpc.ts";
import contribute from "../index.server.ts";
import { makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const WS = "wks_1111111aaaaaaa";
const AGENT = "aaaaaaa1-full";
const NOW = new Date("2026-11-27T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

function world(t: { after: (fn: () => void) => void }) {
  const root = tempDir(t);
  const dir = join(root, "state", "paseo-tabs", "pending");
  mkdirSync(dir, { recursive: true });
  const home = makeHome(root);
  writeWorkspaces(home, [{ workspaceId: WS, cwd: "/w", title: "T", archivedAt: null }]);
  writeAgent(home, { id: AGENT, cwd: "/w", workspaceId: WS, title: "tab" });
  const F = { kind: "waiting" as const, what: "x", action: "a", minutes: 1, why: "w" };
  addItem(dir, WS, "/w", AGENT, F, ago(60 * MIN));
  finishItem(dir, WS, AGENT, "a", "done", null, ago(30 * MIN));
  return { root, dir, home, registry: join(root, "reg.json") };
}

function runner(archived: string[]): ControlRunner {
  return { inspect: async () => ({ kind: "unavailable" }), restore: async () => {}, archive: async (id) => void archived.push(id), agentStatus: async () => "idle" };
}

function logLine(time: number, extra = "inboundSessionRequestTypesTop") {
  return JSON.stringify({ level: 30, time, msg: "ws_runtime_metrics", [extra]: [{ type: "dictation_stream_chunk", count: 3 }] });
}

test("pending.activity stores the time and draft length, and a later report replaces it", (t) => {
  const w = world(t);
  assert.deepEqual(pendingActivityHandler(w.dir, AGENT, 12, ago(5 * MIN)), { ok: true });
  assert.equal(activityPath(w.dir), join(w.root, "state", "paseo-tabs", "activity.json"));
  assert.deepEqual(readActivity(w.dir), { [AGENT]: { at: ago(5 * MIN).toISOString(), draftLength: 12 } });
  pendingActivityHandler(w.dir, "other", 0, NOW);
  pendingActivityHandler(w.dir, AGENT, 0, NOW);
  assert.deepEqual(readActivity(w.dir)[AGENT], { at: NOW.toISOString(), draftLength: 0 });
  assert.equal(existsSync(`${activityPath(w.dir)}.lock`), false);
  assert.deepEqual(readActivity(join(w.root, "none", "pending")), {});
});

test("the plugin entry serves pending.activity", async (t) => {
  const root = tempDir(t);
  const handlers = new Map<string, (i: unknown) => unknown>();
  const server = {
    registerSettings: () => ({ read: () => new Promise(() => {}), subscribe: () => () => {} }),
    handle: (c: { name: string }, h: (i: unknown) => unknown) => handlers.set(c.name, h),
    on: () => () => {}, addHook: () => {}, before: () => () => {}, registerProvider: () => {}, registerUsageSource: () => {},
  };
  const saved = { h: process.env.PASEO_HOME, s: process.env.XDG_STATE_HOME };
  process.env.PASEO_HOME = makeHome(root);
  process.env.XDG_STATE_HOME = join(root, "state");
  const cleanup = contribute(server as never);
  t.after(async () => {
    await cleanup?.();
    for (const [k, v] of [["PASEO_HOME", saved.h], ["XDG_STATE_HOME", saved.s]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
  assert.equal(pendingActivity.name, "pending.activity");
  assert.deepEqual(await handlers.get("pending.activity")!({ agentId: AGENT, draftLength: 4 }), { ok: true });
  assert.equal(readActivity(join(root, "state", "paseo-tabs", "pending"))[AGENT].draftLength, 4);
});

test("the throttle sends on change and every 30 s while non-empty, at most once per 10 s", () => {
  const th = new DraftThrottle();
  assert.equal(th.take("a", 0, 0), false, "empty and never reported");
  assert.equal(th.take("a", 3, 1000), true);
  assert.equal(th.take("a", 4, 5000), false, "within 10 s");
  assert.equal(th.take("a", 4, 11_000), true, "held change goes out after the gap");
  assert.equal(th.take("a", 4, 21_000), false, "unchanged, under 30 s");
  assert.equal(th.take("a", 4, 41_000), true, "30 s repeat");
  assert.equal(th.take("b", 1, 41_500), true, "per agent");
  assert.equal(th.take("a", 0, 60_000), true, "cleared text is reported");
  assert.equal(th.take("a", 0, 100_000), false, "empty and unchanged is not repeated");
});

test("recentDictation: inside the window, outside it, no match, no log", (t) => {
  const home = makeHome(tempDir(t));
  assert.equal(recentDictation(home, NOW, 5 * MIN), false, "no log");
  const log = join(home, "daemon.log");
  writeFileSync(log, [logLine(ago(2 * MIN).getTime(), "other"), "not json dictation_stream", JSON.stringify({ time: NOW.getTime(), msg: "plain" })].join("\n").replace("dictation_stream_chunk", "x"));
  assert.equal(recentDictation(home, NOW, 5 * MIN), false, "no dictation_stream in a timed line");
  writeFileSync(log, [logLine(ago(20 * MIN).getTime()), JSON.stringify({ time: NOW.getTime(), msg: "plain" })].join("\n"));
  assert.equal(recentDictation(home, NOW, 5 * MIN), false, "match is too old");
  writeFileSync(log, [logLine(ago(20 * MIN).getTime()), logLine(ago(3 * MIN).getTime()), JSON.stringify({ time: NOW.getTime(), msg: "plain" })].join("\n"));
  assert.equal(recentDictation(home, NOW, 5 * MIN), true);
  // only the tail is read: a match more than 512 KB back is ignored
  writeFileSync(log, `${logLine(ago(1 * MIN).getTime())}\n${"x".repeat(600 * 1024)}\n`);
  assert.equal(recentDictation(home, NOW, 5 * MIN), false);
});

test("auto-archive postpones for activity, an unsent draft and dictation, and archives when quiet", async (t) => {
  const base = (w: ReturnType<typeof world>, archived: string[], posts: number[], attempt = 0) => ({
    agentId: AGENT, dir: w.dir, home: w.home, registry: w.registry, runner: runner(archived), now: NOW, attempt, postpone: (n: number) => void posts.push(n),
  });
  // recent activity, empty draft
  let w = world(t), archived: string[] = [], posts: number[] = [];
  pendingActivityHandler(w.dir, AGENT, 0, ago(9 * MIN));
  assert.match(await autoArchive(base(w, archived, posts)), /activity in its message box.*postponed 10 minutes \(1 of 6\)/);
  assert.deepEqual([archived, posts], [[], [1]]);
  // activity 11 minutes ago does not count
  w = world(t); archived = []; posts = [];
  pendingActivityHandler(w.dir, AGENT, 0, ago(11 * MIN));
  assert.match(await autoArchive(base(w, archived, posts)), /archived/);
  assert.deepEqual([archived, posts], [[WS], []]);
  // non-empty draft reported 2 minutes ago
  w = world(t); archived = []; posts = [];
  pendingActivityHandler(w.dir, AGENT, 5, ago(2 * MIN));
  assert.match(await autoArchive(base(w, archived, posts, 2)), /unsent text.*\(3 of 6\)/);
  assert.deepEqual([archived, posts], [[], [3]]);
  // dictation 4 minutes ago
  w = world(t); archived = []; posts = [];
  writeFileSync(join(w.home, "daemon.log"), `${logLine(ago(4 * MIN).getTime())}\n`);
  assert.match(await autoArchive(base(w, archived, posts)), /voice dictation.*postponed/);
  assert.deepEqual([archived, posts], [[], [1]]);
  // gives up after 6 postponements
  assert.match(await autoArchive(base(w, archived, posts, MAX_POSTPONEMENTS)), /giving up, not archived/);
  assert.deepEqual([archived, posts], [[], [1]]);
  // quiet: archives
  w = world(t); archived = []; posts = [];
  assert.match(await autoArchive(base(w, archived, posts)), /archived/);
  assert.deepEqual([archived, posts], [[WS], []]);
  // a message after scheduling still cancels, even with activity
  w = world(t); archived = []; posts = [];
  pendingActivityHandler(w.dir, AGENT, 5, ago(1 * MIN));
  writeAgent(w.home, { id: AGENT, cwd: "/w", workspaceId: WS, lastUserMessageAt: ago(2 * MIN).toISOString() });
  assert.match(await autoArchive({ ...base(w, archived, posts), scheduledAt: ago(5 * MIN) }), /got a message after the archive was scheduled/);
  assert.deepEqual([archived, posts], [[], []]);
});
