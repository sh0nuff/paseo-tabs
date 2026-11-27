import { type PluginWorkspaceRowBadgeItemProps, useAgents, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { displaySettings } from "../shared/settings.ts";
import { tabsLines } from "../shared/tabs-rpc.ts";
import { DraftActivity } from "./use-draft-activity.tsx";
import { lineView } from "./line-view.ts";
import { statusColours } from "./palettes.ts";

/** A workspace's sidebar row: its most urgent open tab and what waits on the user, from TABS.md. */
export function TabsLine({ theme, workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const fetchLines = useRpc(tabsLines);
  const settings = useSettings(displaySettings);
  const dots = settings.status === "ready" ? settings.values.statusDots : true;
  const palette = settings.status === "ready" ? settings.values.palette : "default";
  // Drawn, not emoji: emoji colours depend on the fonts each machine has.
  const colours = useMemo(() => statusColours(palette, theme.colors.surface0), [palette, theme]);
  // One key for every row, so the host answers one call per refetch, not one per workspace.
  const query = useQuery({
    queryKey: ["paseo-tabs", "lines"],
    queryFn: () => fetchLines({}),
    refetchInterval: 5000,
  });

  const view = lineView(query.data?.lines, workspaceId, dots, colours);
  // The row mounts on phones too, where the composer item only mounts while its sheet is open.
  const tabIds = useAgents({ where: (a) => a.workspaceId === workspaceId && a.status !== "closed" }).map((a) => a.id);
  const watcher = <DraftActivity agentIds={tabIds} />;
  if (!view) return watcher;
  return (
    <View
      accessibilityLabel={`Tab status: ${view.text}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1 }}
    >
      {watcher}
      {view.colour ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: view.colour }} /> : null}
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}
      >
        {view.text}
      </Text>
    </View>
  );
}
