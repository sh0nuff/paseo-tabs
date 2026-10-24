import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoHome } from "./server/paseo-state.ts";
import { listTabs } from "./server/tabs-list.ts";
import { startWatcher } from "./server/watcher.ts";
import { tabsList } from "./shared/tabs-rpc.ts";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome(process.env);
  const stop = startWatcher(home);
  server.handle(tabsList, ({ workspaceId }) => ({ tabs: listTabs(home, workspaceId) }));
  return () => stop();
}
