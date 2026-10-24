import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import contribute from "../index.server.ts";
import { gitInit, makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

type Listener = (state: unknown) => void;

function fakeServer() {
  const listeners: Listener[] = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  let stored: unknown = { status: "ready", revision: "1", values: { statusDots: true, shortenNames: true, maxNameLength: 40 } };
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
    before: () => () => {},
    registerProvider: () => {},
    registerUsageSource: () => {},
  };
  const emit = (state: unknown) => {
    stored = state;
    for (const listener of listeners) listener(state);
  };
  return { server, handlers, emit };
}

test("the plugin entry applies saved settings and serves tabs.list", async (t) => {
  const root = tempDir(t);
  const home = makeHome(root);
  const repo = gitInit(join(root, "repo"));
  writeWorkspaces(home, [{ workspaceId: "wks_1111111aaaaaaa", cwd: repo, title: "One" }]);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: repo });
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n**Waiting on you**\n- a) [ ] answer\n");
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const { server, handlers, emit } = fakeServer();

  const cleanup = contribute(server as never);
  t.after(async () => {
    await cleanup?.();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
  });
  await sleep(20);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 🟠 1\. A title · aaaaaaa$/m);

  emit({ status: "ready", revision: "2", values: { statusDots: false, shortenNames: true, maxNameLength: 40 } });
  await sleep(20);
  assert.match(readFileSync(join(repo, "TABS.md"), "utf8"), /^## 1\. A title · aaaaaaa$/m);

  const result = (await handlers.get("tabs.list")!({ workspaceId: "wks_1111111aaaaaaa" })) as { tabs: { status: string }[] };
  assert.equal(result.tabs[0].status, "waiting");
});
