import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/settings-screen.tsx";
import { TabsPanel } from "./client/tabs-panel.tsx";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "tabs",
    title: "Tabs",
    icon: "ListChecks",
    context: "workspace",
    Component: TabsPanel,
  });
  client.addCommandCenterItem({
    id: "open-tabs",
    title: "Open Tabs",
    icon: "ListChecks",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("tabs");
    },
  });
  client.addSettingsScreen({
    id: "display",
    title: "Tabs",
    icon: "ListChecks",
    Component: SettingsScreen,
  });
  return () => {};
}
