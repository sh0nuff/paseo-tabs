import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import contribute from "../index.server.ts";
import { gitInit, makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

type Listener = (state: unknown) => void;

function fakeServer(initial?: unknown) {
  const listeners: Listener[] = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  const hooks = new Map<string, unknown>();
  let stored: unknown = initial ?? { status: "ready", revision: "1", values: { statusDots: true, shortenNames: true, maxNameLength: 40, overdueAfterDays: 7, palette: "default", workspaceOrder: "newest", removeFinished: true } };
  const server = {
    registerSettings: () => ({
      read: async () => stored,
      subscribe: (listener: Listener) => {
        listeners.push(listener);
        return () => {};
      },
    }),
    handle: (contract: { name: string }, handler: (input: unknown) => unknown) => handlers.set(contract.name, handler),
    on: () => () => {},
    addHook: (name: string, handler: unknown) => hooks.set(name, handler),
    before: () => () => {},
    registerProvider: () => {},
    registerUsageSource: () => {},
  };
  const emit = (state: unknown) => {
    stored = state;
    for (const listener of listeners) listener(state);
  };
  return { server, handlers, emit, hooks };
}

test("the plugin entry applies saved settings and serves tabs.list", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeWorkspaces(home, [{ workspaceId: "wks_1111111aaaaaaa", cwd: repo, title: "One" }]);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n");
  const previousHome = process.env.PASEO_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.PASEO_HOME = home;
  process.env.XDG_STATE_HOME = join(root, "state");
  const { server, handlers, emit } = fakeServer();

  const cleanup = contribute(server as never);
  t.after(async () => {
    await cleanup?.();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
  });
  await sleep(20);
  for (const name of ["pending.list", "pending.pick", "pending.search"]) assert.ok(handlers.has(name), name);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🟠 1\. A title · aaaaaaa$/m);
  assert.deepEqual(await handlers.get("tabs.lines")!({}), {
    lines: { wks_1111111aaaaaaa: { status: "waiting", title: "A title", waiting: "answer", more: 0 } },
  });

  emit({ status: "ready", revision: "2", values: { statusDots: false, shortenNames: true, maxNameLength: 40, overdueAfterDays: 7, palette: "default", workspaceOrder: "newest", removeFinished: true } });
  await sleep(20);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);

  const result = (await handlers.get("tabs.list")!({ workspaceId: "wks_1111111aaaaaaa" })) as { tabs: { status: string }[] };
  assert.equal(result.tabs[0].status, "waiting");
});

test("the first write uses the saved settings, not the defaults", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo });
  const text = "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n";
  writeFileSync(join(repo, "TABS.md"), text);
  const previousHome = process.env.PASEO_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.PASEO_HOME = home;
  process.env.XDG_STATE_HOME = join(root, "state");
  const { server } = fakeServer({ status: "ready", revision: "1", values: { statusDots: false, shortenNames: true, maxNameLength: 40, overdueAfterDays: 7, palette: "default", workspaceOrder: "newest", removeFinished: true } });

  const cleanup = contribute(server as never);
  t.after(async () => {
    await cleanup?.();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
  });

  assert.equal(readFileSync(join(repo, "TABS.md"), "utf8"), text);
  await sleep(20);
  assert.equal(readFileSync(join(repo, "TABS.md"), "utf8"), text);
});

test("the plugin entry keeps its clock under XDG_STATE_HOME", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n");
  const previousHome = process.env.PASEO_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.PASEO_HOME = home;
  process.env.XDG_STATE_HOME = join(root, "state");
  const { server } = fakeServer();

  const cleanup = contribute(server as never);
  t.after(async () => {
    await cleanup?.();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
  });
  await sleep(20);

  const files = readdirSync(join(root, "state", "paseo-tabs"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^items-[0-9a-f]{8}\.json$/);
  assert.match(readFileSync(join(root, "state", "paseo-tabs", files[0]), "utf8"), /"aaaaaaa:a"/);
});

test("the plugin entry attaches the pending tools to Claude agents only, and only after cut-over", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const previousHome = process.env.PASEO_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.PASEO_HOME = home;
  process.env.XDG_STATE_HOME = join(root, "state");
  const { server, hooks, handlers } = fakeServer();
  const cleanup = contribute(server as never);
  t.after(async () => {
    await cleanup?.();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
  });
  const hook = hooks.get("agent.open.before") as (a: { request: unknown }) => Promise<{ tools: { name: string }[] } | undefined>;
  // Before cut-over: no tools, and pending.enabled says so.
  assert.equal(await hook({ request: { provider: "claude", tools: [] } }), undefined);
  assert.deepEqual(await handlers.get("pending.enabled")!({}), { enabled: false });
  const store = join(root, "state", "paseo-tabs", "pending");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, "cutover"), "");
  // The marker is read at each open, so no restart is needed.
  const claude = await hook({ request: { provider: "claude", tools: [] } });
  assert.deepEqual(claude?.tools.map((x) => x.name), ["pending_add", "pending_update", "pending_done", "pending_list", "pending_find"]);
  assert.equal(await hook({ request: { provider: "codex", tools: [] } }), undefined);
  assert.deepEqual(await handlers.get("pending.enabled")!({}), { enabled: true });
  for (const name of ["pending.unpick", "pending.enabled"]) assert.ok(handlers.has(name), name);
});
