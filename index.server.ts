import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoHome } from "./server/paseo-state.ts";
import { DEFAULT_DISPLAY, type DisplayOptions } from "./server/tabs-file.ts";
import { listTabs } from "./server/tabs-list.ts";
import { startWatcher } from "./server/watcher.ts";
import { displaySettings } from "./shared/settings.ts";
import { tabsList } from "./shared/tabs-rpc.ts";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome(process.env);
  let display: DisplayOptions = DEFAULT_DISPLAY;
  const watcher = startWatcher(home, { display: () => display });

  const settings = server.registerSettings(displaySettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status !== "ready") {
      console.error(`paseo-tabs: settings unusable, keeping the current ones: ${state.error}`);
      return;
    }
    display = state.values;
    watcher.refresh();
  };
  void settings.read().then(apply, (error) => console.error("paseo-tabs: could not read settings:", error));
  const unsubscribe = settings.subscribe(apply);

  server.handle(tabsList, ({ workspaceId }) => ({ tabs: listTabs(home, workspaceId, new Date(), display) }));
  return () => {
    unsubscribe();
    watcher.stop();
  };
}
