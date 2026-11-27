import type { PluginServerContext } from "@getpaseo/plugin/server";
import { pendingActivityHandler } from "./server/activity.ts";
import { registryPath } from "./server/archived-tabs.ts";
import { decisionLine, startSweeper, sweep } from "./server/sweep.ts";
import { paseoRunner } from "./server/workspace-control.ts";
import { ItemClock, clockPath } from "./server/item-clock.ts";
import { paseoHome } from "./server/paseo-state.ts";
import { pendingEnabledHandler, storeMode, pendingListHandler, pendingPickHandler, pendingSearchHandler, pendingUnpickHandler } from "./server/pending-rpc.ts";
import { pendingDir } from "./server/pending-store.ts";
import { pendingToolsHook } from "./server/pending-tools.ts";
import { DEFAULT_DISPLAY, type DisplayOptions } from "./server/tabs-file.ts";
import { cachedFor, workspaceLines } from "./server/tabs-lines.ts";
import { listTabs } from "./server/tabs-list.ts";
import { storeLines, storeTabRows } from "./server/pending-lines.ts";
import { type Watcher, startWatcher } from "./server/watcher.ts";
import { displaySettings } from "./shared/settings.ts";
import { pendingEnabled, pendingList, pendingPick, pendingSearch, pendingUnpick } from "./shared/pending-rpc.ts";
import { pendingActivity } from "./shared/activity-rpc.ts";
import { tabsLines, tabsList } from "./shared/tabs-rpc.ts";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome(process.env);
  let display: DisplayOptions = DEFAULT_DISPLAY;
  const clock = new ItemClock(clockPath(process.env, home));
  let watcher: Watcher | null = null;
  let stopped = false;
  // The first pass waits for the saved settings, so a file is never written
  // with the defaults and then again with the user's choice.
  const start = () => {
    if (!stopped && !watcher) watcher = startWatcher(home, { display: () => display, clock, pendingDir: pendingDir(process.env) });
  };

  const settings = server.registerSettings(displaySettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status !== "ready") {
      console.error(`paseo-tabs: settings unusable, keeping the current ones: ${state.error}`);
      return;
    }
    display = state.values;
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

  // The tools and the panel stay off until the cut-over marker exists.
  server.addHook("agent.open.before", pendingToolsHook(pendingDir(process.env)));

  const pendingOn = () => storeMode(display, pendingDir(process.env));
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
  const store = pendingDir(process.env);
  server.handle(pendingList, ({ workspaceId }) => pendingListHandler(store, workspaceId));
  server.handle(pendingPick, ({ workspaceId, agentId, letter, done }) => pendingPickHandler(store, workspaceId, agentId, letter, new Date(), done === true));
  server.handle(pendingUnpick, ({ workspaceId, agentId, letter }) => pendingUnpickHandler(store, workspaceId, agentId, letter));
  server.handle(pendingEnabled, () => pendingEnabledHandler(store));
  server.handle(pendingSearch, ({ query }) => pendingSearchHandler(store, home, query));
  server.handle(pendingActivity, ({ agentId, draftLength }) => pendingActivityHandler(store, agentId, draftLength, new Date()));

  // Archives finished, quiet workspaces every 5 minutes, for tabs whose Stop hook never loaded.
  // PASEO_TABS_SWEEP_DRY_RUN=1 only logs what it would archive.
  const dryRun = process.env.PASEO_TABS_SWEEP_DRY_RUN === "1";
  const sweeper = startSweeper(async () => {
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
