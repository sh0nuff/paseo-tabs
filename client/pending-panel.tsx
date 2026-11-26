import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type PendingCard, pendingEnabled, pendingList, pendingPick, pendingSearch, pendingUnpick } from "../shared/pending-rpc.ts";
import { sendPicked } from "./pending-send.ts";

export function PendingPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const fetchList = useRpc(pendingList);
  const pick = useRpc(pendingPick);
  const unpick = useRpc(pendingUnpick);
  const checkEnabled = useRpc(pendingEnabled);
  const search = useRpc(pendingSearch);
  const queryClient = useQueryClient();
  // "waiting": send queued for the tab. "sent": the message went out.
  const [queued, setQueued] = useState<Record<string, "waiting" | "sent" | undefined>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [text, setText] = useState("");
  const term = text.trim();

  // Nothing is listed until the cut-over marker exists; asked again every 30 seconds.
  const enabled = useQuery({
    queryKey: ["paseo-pending-enabled"],
    queryFn: () => checkEnabled({}),
    refetchInterval: 30_000,
  });
  const on = enabled.data?.enabled === true;
  const query = useQuery({
    queryKey: ["paseo-pending", workspaceId],
    queryFn: () => fetchList({ workspaceId }),
    refetchInterval: 5000,
    enabled: on,
  });
  const hits = useQuery({
    queryKey: ["paseo-pending-search", term],
    queryFn: () => search({ query: term }),
    enabled: on && term.length > 0,
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 16, gap: 8 },
      header: { color: theme.colors.foreground, fontSize: 16, fontWeight: "700" as const, marginBottom: 4 },
      card: {
        flexDirection: "row" as const,
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      radio: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.foregroundMuted,
        marginTop: 2,
      },
      radioOn: { backgroundColor: theme.colors.foregroundMuted },
      body: { flex: 1, gap: 3 },
      what: { color: theme.colors.foreground, fontSize: layout.compact ? 15 : 16, fontWeight: "700" as const },
      line: { color: theme.colors.foregroundMuted, fontSize: 13 },
      state: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      error: { color: theme.colors.foreground, fontSize: 13 },
      search: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        marginTop: 12,
      },
      hit: { paddingVertical: 8, paddingHorizontal: 4 },
      message: { color: theme.colors.foregroundMuted, fontSize: 14 },
    }),
    [theme, layout.compact],
  );

  const choose = async (card: PendingCard) => {
    // Only a send already queued from this panel stops a second press. A card picked earlier
    // is left to the server, which refuses a pick that still stands.
    if (queued[cardKey(card)] === "waiting") return;
    setFailure(null);
    try {
      // The RPC marks the item picked and returns the message; sending comes after.
      const { message } = await pick({ workspaceId, agentId: card.agentId, letter: card.letter });
      setQueued((q) => ({ ...q, [cardKey(card)]: "waiting" }));
      void queryClient.invalidateQueries({ queryKey: ["paseo-pending", workspaceId] });
      const ref = paseo.agents.ref(card.agentId);
      // A handle's properties may be a snapshot, so read the status from current() after a refresh.
      const adapter = {
        status: null as string | null,
        async refresh() {
          await ref.refresh();
          adapter.status = ref.current()?.status ?? null;
        },
        send: (body: string) => ref.send(body),
      };
      const sender = sendPicked(adapter, message, () => unpick({ workspaceId, agentId: card.agentId, letter: card.letter }), {
        key: workspaceId,
      });
      sender.done
        .then(() => setQueued((q) => ({ ...q, [cardKey(card)]: q[cardKey(card)] === "waiting" ? "sent" : q[cardKey(card)] })))
        .catch((error: unknown) => {
          setFailure(error instanceof Error ? error.message : String(error));
          setQueued((q) => ({ ...q, [cardKey(card)]: undefined }));
          void queryClient.invalidateQueries({ queryKey: ["paseo-pending", workspaceId] });
        });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const searchBox = (
    <>
      <TextInput
        style={styles.search}
        value={text}
        onChangeText={setText}
        placeholder="Search all workspaces"
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="Search all workspaces"
      />
      {term.length > 0 && hits.isError ? <Text style={styles.error}>{hits.error.message}</Text> : null}
      {term.length > 0 && hits.data
        ? hits.data.hits.map((hit) => (
            <Pressable
              key={`${hit.workspaceId}-${hit.card.agentId}-${hit.card.letter}`}
              accessibilityRole="button"
              style={styles.hit}
              onPress={() => navigation?.openWorkspace({ workspaceId: hit.workspaceId })}
            >
              <Text style={styles.line}>{`${hit.workspaceName}: ${hit.card.what}`}</Text>
            </Pressable>
          ))
        : null}
    </>
  );

  if (!on) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.message}>{enabled.isPending ? "Loading…" : "The Pending panel starts at cut-over."}</Text>
      </View>
    );
  }
  if (query.isPending) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.message}>Loading…</Text>
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.message}>{query.error.message}</Text>
      </View>
    );
  }

  const items = query.data.items;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.header}>{`Waiting on you · ${items.length}`}</Text>
      {failure ? <Text style={styles.error}>{failure}</Text> : null}
      {items.length === 0 ? <Text style={styles.message}>No pending items</Text> : null}
      {items.map((card) => {
        const waiting = queued[cardKey(card)] === "waiting";
        return (
          <Pressable
            key={cardKey(card)}
            accessibilityRole="radio"
            accessibilityState={{ selected: card.picked || waiting }}
            onPress={() => void choose(card)}
            style={styles.card}
          >
            <View style={[styles.radio, card.picked || waiting ? styles.radioOn : null]} />
            <View style={styles.body}>
              <Text style={styles.what}>{card.what}</Text>
              <Text style={styles.line}>{`Action: ${card.action || "ask the tab"}`}</Text>
              <Text style={styles.line}>{`About ${card.minutes} min`}</Text>
              {card.why ? <Text style={styles.line}>{`Why: ${card.why}`}</Text> : null}
              {card.picked && !waiting ? <Text style={styles.state}>In progress</Text> : null}
              {waiting ? <Text style={styles.state}>Sent when the tab finishes</Text> : null}
            </View>
          </Pressable>
        );
      })}
      {searchBox}
    </ScrollView>
  );
}

function cardKey(card: PendingCard): string {
  return `${card.agentId}-${card.letter}`;
}
