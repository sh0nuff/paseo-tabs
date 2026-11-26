import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PendingPanel } from "./client/pending-panel.tsx";
import { SettingsScreen } from "./client/settings-screen.tsx";
import { TabsLine } from "./client/tabs-line.tsx";
import { TabsPanel } from "./client/tabs-panel.tsx";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "tabs",
    title: "Tabs",
    icon: "ListChecks",
    context: "workspace",
    Component: TabsPanel,
  });
  client.addWorkspacePanel({
    id: "pending",
    title: "Pending",
    icon: "ListChecks",
    context: "workspace",
    Component: PendingPanel,
  });
  client.addCommandCenterItem({
    id: "open-pending",
    title: "Open Pending",
    icon: "ListChecks",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("pending");
    },
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
  // Paseo apps before 0.16 have no workspace row slot. They keep the panel.
  if (typeof client.addWorkspaceRowBadgeItem === "function") {
    client.addWorkspaceRowBadgeItem({
      id: "status",
      title: "Tab status",
      icon: "ListChecks",
      Component: TabsLine,
    });
  }
  return () => {};
}
