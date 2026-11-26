import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ItemClock, clockPath } from "./server/item-clock.ts";
import { paseoHome } from "./server/paseo-state.ts";
import { pendingDir } from "./server/pending-store.ts";
import { pendingTools } from "./server/pending-tools.ts";
import { DEFAULT_DISPLAY, type DisplayOptions } from "./server/tabs-file.ts";
import { cachedFor, workspaceLines } from "./server/tabs-lines.ts";
import { listTabs } from "./server/tabs-list.ts";
import { type Watcher, startWatcher } from "./server/watcher.ts";
import { displaySettings } from "./shared/settings.ts";
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
    if (!stopped && !watcher) watcher = startWatcher(home, { display: () => display, clock });
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

  const tools = pendingTools(pendingDir(process.env));
  server.addHook("agent.open.before", async ({ request }) =>
    request.provider === "claude" ? { ...request, tools: [...request.tools, ...tools] } : undefined,
  );

  server.handle(tabsList, ({ workspaceId }) => ({ tabs: listTabs(home, workspaceId, new Date(), display, clock) }));
  // Every sidebar row asks for its line, so the answer is worked out at most every 2 seconds.
  const lines = cachedFor(2000, () => workspaceLines(home, new Date(), display, clock));
  server.handle(tabsLines, () => ({ lines: lines() }));
  return () => {
    stopped = true;
    unsubscribe();
    watcher?.stop();
  };
}
