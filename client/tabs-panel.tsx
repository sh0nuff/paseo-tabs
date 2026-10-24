import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type TabRow, tabsList } from "../shared/tabs-rpc.ts";

export function TabsPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const fetchTabs = useRpc(tabsList);
  const query = useQuery({
    queryKey: ["paseo-tabs", workspaceId],
    queryFn: () => fetchTabs({ workspaceId }),
    refetchInterval: 5000,
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 20, gap: layout.compact ? 6 : 8 },
      label: { color: theme.colors.foregroundMuted, fontSize: 13, marginTop: 12 },
      row: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 2,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 15 : 16 },
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
    const body = (
      <>
        <Text style={styles.title}>{`${tab.number}. ${tab.title}`}</Text>
        <Text style={styles.detail}>{`${tab.short} · Waiting on you ${tab.waiting} · Next steps ${tab.next}`}</Text>
      </>
    );
    if (!navigation) {
      return (
        <View key={tab.agentId} style={styles.row}>
          {body}
        </View>
      );
    }
    return (
      <Pressable
        key={tab.agentId}
        accessibilityRole="button"
        accessibilityLabel={`Open tab ${tab.number}, ${tab.title}`}
        onPress={() => navigation.openAgent({ agentId: tab.agentId })}
        style={styles.row}
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
