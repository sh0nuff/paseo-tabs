import { type PluginWorkspacePanelProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { displaySettings } from "../shared/settings.ts";
import { type TabRow, tabsList } from "../shared/tabs-rpc.ts";

const DOTS = { waiting: "🟠", next: "🔵", done: "✅" } as const;

function summary(tab: TabRow): string {
  if (tab.status === null) return "No items yet";
  const parts = [];
  if (tab.waiting > 0) parts.push(`${tab.waiting} waiting on you`);
  if (tab.next > 0) parts.push(`${tab.next} next`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing open";
}

export function TabsPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const fetchTabs = useRpc(tabsList);
  const settings = useSettings(displaySettings);
  const dots = settings.status === "ready" ? settings.values.statusDots : true;
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
      waitingRow: { borderLeftColor: theme.colors.accent },
      closedRow: { opacity: 0.55 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 15 : 16 },
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
    const waiting = !tab.closed && tab.status === "waiting";
    const dot = dots && !tab.closed && tab.status ? `${DOTS[tab.status]} ` : "";
    const rowStyle = [styles.row, waiting ? styles.waitingRow : null, tab.closed ? styles.closedRow : null];
    const body = (
      <>
        <Text style={[styles.title, waiting ? styles.bold : null]} numberOfLines={1}>
          {`${dot}${tab.number}. ${tab.title}`}
        </Text>
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
