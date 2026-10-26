import { type PluginWorkspacePanelProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { displaySettings } from "../shared/settings.ts";
import { statusColours } from "./palettes.ts";
import { type TabRow, tabsList } from "../shared/tabs-rpc.ts";


function summary(tab: TabRow): string {
  if (tab.status === null) return "No checklist yet";
  const parts = [];
  if (tab.waiting > 0) parts.push(`${tab.waiting} waiting on you${tab.overdue > 0 ? ` (${tab.overdue} overdue)` : ""}`);
  if (tab.next > 0) parts.push(`${tab.next} next`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing open";
}

export function TabsPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const fetchTabs = useRpc(tabsList);
  const settings = useSettings(displaySettings);
  const dots = settings.status === "ready" ? settings.values.statusDots : true;
  const palette = settings.status === "ready" ? settings.values.palette : "default";
  // Drawn, not emoji: emoji colours depend on the fonts each machine has.
  const colours = useMemo(() => statusColours(palette, theme.colors.surface0), [palette, theme]);
  const query = useQuery({
    queryKey: ["paseo-tabs", workspaceId],
    queryFn: () => fetchTabs({ workspaceId }),
    refetchInterval: 5000,
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 16, gap: 8 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 14, marginLeft: 2 },
      row: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderLeftWidth: 4,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 3,
      },

      closedRow: { opacity: 0.55 },
      titleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      dot: { width: 10, height: 10, borderRadius: 5 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 15 : 16, flexShrink: 1 },
      bold: { fontWeight: "700" as const },
      about: { color: theme.colors.foregroundMuted, fontSize: 13 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      message: { color: theme.colors.foregroundMuted, fontSize: 14 },
    }),
    [theme, layout.compact],
  );

  if (query.isPending) return <Message style={styles} text="Loading tabs…" />;
  if (query.isError) return <Message style={styles} text={`Couldn't read the tabs: ${query.error.message}`} />;

  const tabs = query.data.tabs;
  if (tabs.length === 0) return <Message style={styles} text="No tabs in this workspace." />;
  const open = tabs.filter((tab) => !tab.closed);
  const closed = tabs.filter((tab) => tab.closed);

  const row = (tab: TabRow) => {
    const waiting = !tab.closed && (tab.status === "waiting" || tab.status === "overdue");
    const colour = dots && !tab.closed && tab.status ? colours[tab.status] : null;
    const rowStyle = [
      styles.row,
      colour ? { borderLeftColor: colour } : null,
      tab.closed ? styles.closedRow : null,
    ];
    const body = (
      <>
        <View style={styles.titleLine}>
          {colour ? <View style={[styles.dot, { backgroundColor: colour }]} /> : null}
          <Text style={[styles.title, waiting ? styles.bold : null]} numberOfLines={1}>
            {`${tab.number}. ${tab.title}`}
          </Text>
        </View>
        {tab.about ? (
          <Text style={styles.about} numberOfLines={2}>
            {tab.about}
          </Text>
        ) : null}
        <Text style={styles.detail}>{`${summary(tab)} · ${tab.short}`}</Text>
      </>
    );
    if (!navigation) {
      return (
        <View key={tab.agentId} style={rowStyle}>
          {body}
        </View>
      );
    }
    return (
      <Pressable
        key={tab.agentId}
        accessibilityRole="button"
        accessibilityLabel={`Open tab ${tab.number}, ${tab.title}. ${summary(tab)}`}
        onPress={() => navigation.openAgent({ agentId: tab.agentId })}
        style={rowStyle}
      >
        {body}
      </Pressable>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {open.map(row)}
      {closed.length > 0 ? <Text style={styles.label}>Closed</Text> : null}
      {closed.map(row)}
    </ScrollView>
  );
}

function Message({ style, text }: { style: { screen: object; content: object; message: object }; text: string }) {
  return (
    <View style={[style.screen, style.content]}>
      <Text style={style.message}>{text}</Text>
    </View>
  );
}
