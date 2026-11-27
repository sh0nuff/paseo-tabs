import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type PendingCard, pendingEnabled, pendingList, pendingPick, pendingSearch, pendingUnpick } from "../shared/pending-rpc.ts";
import { waitingLabel } from "./pending-age.ts";
import { sendPicked } from "./pending-send.ts";

export function PendingPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const fetchList = useRpc(pendingList);
  const pick = useRpc(pendingPick);
  const unpick = useRpc(pendingUnpick);
  const checkEnabled = useRpc(pendingEnabled);
  const search = useRpc(pendingSearch);
  const queryClient = useQueryClient();
  // "sending": the send call is in flight. "sent": the message went out (shown for a few seconds).
  const [queued, setQueued] = useState<Record<string, "sending" | "sent" | undefined>>({});
  // "Mark done" sends, tracked apart from the radio pick so each guards only itself.
  const [doneQueued, setDoneQueued] = useState<Record<string, "sending" | "sent" | undefined>>({});
  const [failure, setFailureState] = useState<{ text: string; key: string | null } | null>(null);
  const setFailure = (error: unknown, key: string | null) => {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replace(/\s*requestType=.*$/s, "").trim();
    setFailureState({ text: `Couldn't send: ${message}`, key });
  };
  const [text, setText] = useState("");
  const term = text.trim();

  // Nothing is listed in mode tabs-md; asked again every 30 seconds.
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
  // The failure text clears after 30 seconds, and once a refresh shows its card gone or no longer picked.
  useEffect(() => {
    if (!failure) return;
    const timer = setTimeout(() => setFailureState(null), 30_000);
    return () => clearTimeout(timer);
  }, [failure]);
  useEffect(() => {
    if (!failure?.key || !query.data) return;
    const card = query.data.items.find((c) => cardKey(c) === failure.key);
    if (!card || !card.picked) setFailureState(null);
  }, [query.data, failure]);
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

  const submit = async (card: PendingCard, done: boolean) => {
    const key = cardKey(card);
    const setState = done ? setDoneQueued : setQueued;
    setFailureState(null);
    try {
      // The RPC marks the item picked and returns the message; sending comes after.
      const { message } = await pick({ workspaceId, agentId: card.agentId, letter: card.letter, ...(done ? { done: true } : {}) });
      setState((q) => ({ ...q, [key]: "sending" }));
      void queryClient.invalidateQueries({ queryKey: ["paseo-pending", workspaceId] });
      const ref = paseo.agents.ref(card.agentId);
      // A handle's properties may be a snapshot, so read the status from current() after a refresh.
      const adapter = {
        status: null as string | null,
        pendingPermissions: 0,
        async refresh() {
          await ref.refresh();
          const current = ref.current();
          adapter.status = current?.status ?? null;
          adapter.pendingPermissions = current?.pendingPermissions?.length ?? 0;
        },
        send: (body: string, options?: { activeTurnBehavior: "steer" | "interrupt" }) => ref.send(body, options),
      };
      try {
        await sendPicked(adapter, message, () => unpick({ workspaceId, agentId: card.agentId, letter: card.letter }));
        setState((q) => ({ ...q, [key]: "sent" }));
        setTimeout(() => setState((q) => ({ ...q, [key]: q[key] === "sent" ? undefined : q[key] })), 4000);
      } catch (error) {
        setFailure(error, key);
        setState((q) => ({ ...q, [key]: undefined }));
        void queryClient.invalidateQueries({ queryKey: ["paseo-pending", workspaceId] });
      }
    } catch (error) {
      setFailure(error, key);
    }
  };

  // Only a send still in flight from this panel stops a second press. A card picked earlier
  // is left to the server, which refuses a pick that still stands.
  const choose = async (card: PendingCard) => {
    if (queued[cardKey(card)] === "sending") return;
    await submit(card, false);
  };

  // Goes through at once, even while a pick's send is in flight.
  const markDone = async (card: PendingCard) => {
    if (doneQueued[cardKey(card)] === "sending") return;
    await submit(card, true);
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
        <Text style={styles.message}>{enabled.isPending ? "Loading…" : "The Pending panel is off: this install uses the TABS.md file. Switch Mode under Settings, Plugins, Tabs."}</Text>
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
      {failure ? <Text style={styles.error}>{failure.text}</Text> : null}
      {items.length === 0 ? <Text style={styles.message}>No pending items</Text> : null}
      {items.map((card) => {
        const waiting = queued[cardKey(card)] === "sending";
        const sent = queued[cardKey(card)] === "sent";
        const doneSent = doneQueued[cardKey(card)] === "sent";
        return (
          <View key={cardKey(card)}>
            <Pressable
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
                <Text style={styles.line}>{waitingLabel(card.created, new Date())}</Text>
                {card.why ? <Text style={styles.line}>{`Why: ${card.why}`}</Text> : null}
                {card.picked && !waiting ? <Text style={styles.state}>In progress</Text> : null}
                {sent ? <Text style={styles.state}>Sent</Text> : null}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Mark done" style={styles.hit} onPress={() => void markDone(card)}>
              <Text style={styles.line}>Mark done</Text>
              {doneSent ? <Text style={styles.state}>Sent</Text> : null}
            </Pressable>
          </View>
        );
      })}
      {searchBox}
    </ScrollView>
  );
}

function cardKey(card: PendingCard): string {
  return `${card.agentId}-${card.letter}`;
}
