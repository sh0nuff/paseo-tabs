import type { PluginServerContext } from "@getpaseo/plugin/server";
import { pendingActivityHandler } from "./server/activity.ts";
import { registryPath } from "./server/archived-tabs.ts";
import { decisionLine, startSweeper, sweep } from "./server/sweep.ts";
import { paseoRunner } from "./server/workspace-control.ts";
import { ItemClock, clockPath } from "./server/item-clock.ts";
import { paseoHome } from "./server/paseo-state.ts";
import { pendingEnabledHandler, storeMode, pendingListHandler, pendingPickHandler, pendingSearchHandler, pendingUnpickHandler } from "./server/pending-rpc.ts";
import { pendingDir } from "./server/pending-store.ts";
import { pendingTools, pendingToolsHook } from "./server/pending-tools.ts";
import { ruleHook } from "./server/rule-hook.ts";
import { DEFAULT_DISPLAY, type DisplayOptions } from "./server/tabs-file.ts";
import { cachedFor, workspaceLines } from "./server/tabs-lines.ts";
import { listTabs } from "./server/tabs-list.ts";
import { storeLines, storeTabRows } from "./server/pending-lines.ts";
import { type Watcher, startWatcher } from "./server/watcher.ts";
import { displaySettings } from "./shared/settings.ts";
import { autoArchiveFor, modeFor, savedSettings } from "./lib/install-state.mjs";
import { buildRule } from "./lib/rules.mjs";
import { pendingEnabled, pendingList, pendingPick, pendingSearch, pendingUnpick } from "./shared/pending-rpc.ts";
import { panelOpenClaim } from "./shared/auto-open-rpc.ts";
import { panelOpenClaimHandler, openedPath } from "./server/auto-open.ts";
import { tabsStateDir } from "./lib/install-state.mjs";
import { pendingActivity } from "./shared/activity-rpc.ts";
import { tabsLines, tabsList } from "./shared/tabs-rpc.ts";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome(process.env);
  let display: DisplayOptions = DEFAULT_DISPLAY;
  // Until Paseo hands over the saved settings, the file Paseo keeps them in is read directly.
  let loaded = false;
  // Only the switches that pick the mode are taken from it; the rest wait for Paseo's checked values.
  const saved = (): DisplayOptions => {
    if (loaded) return display;
    const { mode, autoArchive, pendingStore } = savedSettings(process.env);
    return { ...DEFAULT_DISPLAY, mode: mode === "pending" || mode === "tabs-md" ? mode : undefined, autoArchive, pendingStore };
  };
  const clock = new ItemClock(clockPath(process.env, home));
  let watcher: Watcher | null = null;
  let stopped = false;
  // The first pass waits for the saved settings, so a file is never written
  // with the defaults and then again with the user's choice.
  const start = () => {
    if (!stopped && !watcher) watcher = startWatcher(home, { display: saved, clock, pendingDir: pendingDir(process.env) });
  };

  const settings = server.registerSettings(displaySettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status !== "ready") {
      console.error(`paseo-tabs: settings unusable, keeping the current ones: ${state.error}`);
      return;
    }
    display = state.values;
    loaded = true;
    watcher?.refresh();
  };
  void settings.read().then(
    (state) => {
      apply(state);
      start();
    },
    (error) => {
      console.error("paseo-tabs: could not read settings, using the defaults:", error);
      start();
    },
  );
  const unsubscribe = settings.subscribe(apply);

  const store = pendingDir(process.env);
  // Mode "pending" (a fresh install, or a 1.x install after cut-over) turns on the tools and the panel;
  // auto-archive is its own setting. Both are checked at use time, so a change needs no restart.
  const pendingOn = () => storeMode(saved(), store);
  const autoArchiveOn = () => autoArchiveFor(store, saved());
  server.addHook(
    "agent.open.before",
    pendingToolsHook(store, pendingTools(store, { autoArchive: autoArchiveOn }), () => modeFor(store, saved()) === "pending"),
  );
  // The rule reaches every provider through the system prompt, with or without the Claude Code plugin.
  server.addHook(
    "agent.open.before",
    ruleHook((agentId, cwd) => buildRule({ agentId, cwd, env: process.env, saved: saved() })),
  );

  server.handle(tabsList, ({ workspaceId }) => ({
    tabs: pendingOn()
      ? storeTabRows(home, pendingDir(process.env), workspaceId, new Date(), display)
      : listTabs(home, workspaceId, new Date(), display, clock),
  }));
  // Every sidebar row asks for its line, so the answer is worked out at most every 2 seconds.
  const lines = cachedFor(2000, () =>
    pendingOn() ? storeLines(home, pendingDir(process.env), new Date(), display) : workspaceLines(home, new Date(), display, clock),
  );
  server.handle(tabsLines, () => ({ lines: lines() }));
  server.handle(pendingList, ({ workspaceId }) => pendingListHandler(store, workspaceId));
  server.handle(pendingPick, ({ workspaceId, agentId, letter, done }) => pendingPickHandler(store, workspaceId, agentId, letter, new Date(), done === true));
  server.handle(pendingUnpick, ({ workspaceId, agentId, letter }) => pendingUnpickHandler(store, workspaceId, agentId, letter));
  server.handle(pendingEnabled, () => pendingEnabledHandler(store, saved()));
  server.handle(panelOpenClaim, ({ workspaceId }) => panelOpenClaimHandler(openedPath(tabsStateDir(process.env)), workspaceId, pendingOn(), new Date()));
  server.handle(pendingSearch, ({ query }) => pendingSearchHandler(store, home, query));
  server.handle(pendingActivity, ({ agentId, draftLength }) => pendingActivityHandler(store, agentId, draftLength, new Date()));

  // With auto-archive on, archives finished, quiet workspaces every 5 minutes, for tabs whose
  // Stop hook never loaded. PASEO_TABS_SWEEP_DRY_RUN=1 only logs what it would archive.
  const dryRun = process.env.PASEO_TABS_SWEEP_DRY_RUN === "1";
  const sweeper = startSweeper(async () => {
    if (!autoArchiveOn() || !pendingOn()) return;
    const decisions = await sweep({ home, dir: store, registry: registryPath(process.env), runner: paseoRunner(process.env), now: new Date(), dryRun });
    for (const d of decisions) if (d.action !== "skip") console.log(`paseo-tabs sweep: ${decisionLine(d)}`);
  });
  return () => {
    stopped = true;
    sweeper.stop();
    unsubscribe();
    watcher?.stop();
  };
}
