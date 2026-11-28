import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PendingPanel } from "./client/pending-panel.tsx";
import { ComposerDraftActivity } from "./client/use-draft-activity.tsx";
import { SettingsScreen } from "./client/settings-screen.tsx";
import { TabsLine } from "./client/tabs-line.tsx";
import { TabsPanel } from "./client/tabs-panel.tsx";
import { setPanelOpener } from "./client/auto-open.ts";

export default function contribute(client: PluginClientContext) {
  // The workspace row badge below has no client of its own; it opens the panel through this one.
  setPanelOpener((workspaceId) => client.openPanel("pending", { workspaceId }));
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
  // Reports typing in message boxes so a tab is not auto-archived under the user. Renders nothing.
  if (typeof client.addComposerItem === "function") {
    client.addComposerItem({ id: "draft-activity", Component: ComposerDraftActivity });
  }
  // Paseo apps before 0.16 have no workspace row slot. They keep the panel.
  if (typeof client.addWorkspaceRowBadgeItem === "function") {
    client.addWorkspaceRowBadgeItem({
      id: "status",
      title: "Tab status",
      icon: "ListChecks",
      Component: TabsLine,
    });
  }
  return () => {
    setPanelOpener(null);
  };
}
