import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { pendingEnabled } from "../shared/pending-rpc.ts";
import { type DisplayValues, displaySettings } from "../shared/settings.ts";
import { PALETTE_OPTIONS, type PaletteName } from "./palettes.ts";

const LENGTHS = ["25", "30", "40", "50", "60", "80"].map((value) => ({ label: `${value} characters`, value }));
const OVERDUE = [
  { label: "3 days", value: "3" },
  { label: "1 week", value: "7" },
  { label: "2 weeks", value: "14" },
  { label: "30 days", value: "30" },
  { label: "Never", value: "0" },
];
const MODES: { label: string; value: "pending" | "tabs-md" }[] = [
  { label: "Pending panel", value: "pending" },
  { label: "TABS.md file (1.x, legacy)", value: "tabs-md" },
];
const ORDERS: { label: string; value: DisplayValues["workspaceOrder"] }[] = [
  { label: "Newest first", value: "newest" },
  { label: "Latest message first", value: "latestMessage" },
];

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(displaySettings);
  // The mode and auto-archive in force, worked out by the daemon when they were never saved.
  // Plain state rather than a query, so this screen needs nothing from the host but the RPC.
  const checkEnabled = useRpc(pendingEnabled);
  const [effective, setEffective] = useState<{ mode?: "pending" | "tabs-md"; autoArchive?: boolean } | null>(null);
  const refreshEffective = useCallback(() => {
    checkEnabled({}).then(setEffective, () => setEffective(null));
  }, [checkEnabled]);
  useEffect(refreshEffective, [refreshEffective]);

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: 16 },
      message: { color: theme.colors.foregroundMuted, fontSize: 14 },
    }),
    [theme, layout.compact],
  );

  if (settings.status === "loading") {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.message}>Loading settings…</Text>
      </View>
    );
  }

  if (settings.status === "error" || settings.status === "invalid") {
    // A stored document that no longer fits the schema can only be fixed by
    // starting over, so offer that instead of a dead end.
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <SettingsSection title="Tabs">
          <SettingsAction
            label="Couldn't read the settings"
            hint={settings.error}
            actionLabel="Reset to defaults"
            disabled={settings.saving}
            onPress={() => void settings.reset()}
          />
        </SettingsSection>
      </ScrollView>
    );
  }

  const values = settings.values;
  const save = async (change: Partial<DisplayValues>) => {
    // After a conflict the displayed revision is stale, and only a reload
    // fetches the current one, so the next change can succeed.
    const saved = await settings.save({ ...values, ...change }, settings.revision);
    if (!saved) await settings.reload();
    refreshEffective();
  };
  const mode = effective?.mode ?? values.mode ?? "pending";
  const autoArchive = effective?.autoArchive ?? values.autoArchive ?? false;
  const legacy = mode === "tabs-md";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SettingsSection title="Tabs">
        <SettingsSelect
          label="Mode"
          hint="Pending panel: each Claude tab keeps its items with the pending tools, and the panel shows them. TABS.md file: the 1.x checklist file in each repo. A 1.x install keeps TABS.md until you switch; once a 1.x cut-over marker exists the Pending panel stays on."
          value={mode}
          options={MODES}
          disabled={settings.saving}
          onValueChange={(next) => void save({ mode: next as DisplayValues["mode"] })}
        />
        <SettingsSwitch
          label="Archive finished workspaces"
          hint="When every pending item in a workspace is closed, the tab ends with “Nothing further waiting on you.” and the workspace is archived about 10 minutes later, unless you write or dictate first. A new item waiting on you brings it back. Pending panel only."
          value={autoArchive}
          disabled={settings.saving || legacy}
          onValueChange={(next) => void save({ autoArchive: next })}
        />
        <SettingsSwitch
          label="Open the Pending panel in new workspaces"
          hint="When a workspace is created, the Pending panel opens in it once. Pending panel mode only."
          value={values.autoOpenPanel}
          disabled={settings.saving || legacy}
          onValueChange={(autoOpenPanel) => void save({ autoOpenPanel })}
        />
        <SettingsSwitch
          label="Status dots"
          hint="A dot before each open tab: red when something has waited on you too long, orange when something waits on you, blue when only Claude has next steps, a tick when nothing is open."
          value={values.statusDots}
          disabled={settings.saving}
          onValueChange={(statusDots) => void save({ statusDots })}
        />
        <SettingsSwitch
          label="Shorten long names"
          hint="Long tab and workspace names, often a copy of a first message, are shown shorter. The names in Paseo stay as they are."
          value={values.shortenNames}
          disabled={settings.saving}
          onValueChange={(shortenNames) => void save({ shortenNames })}
        />
        <SettingsSelect
          label="Longest name"
          hint="Characters a shortened name keeps."
          value={String(values.maxNameLength)}
          options={LENGTHS}
          disabled={settings.saving || !values.shortenNames}
          error={settings.saveError}
          onValueChange={(length) => void save({ maxNameLength: Number(length) })}
        />
        <SettingsSelect
          label="Overdue after"
          hint="How long an item may wait on you, unchanged, before its tab turns red. Rewording an item starts its clock again."
          value={String(values.overdueAfterDays)}
          options={OVERDUE}
          disabled={settings.saving}
          onValueChange={(days) => void save({ overdueAfterDays: Number(days) })}
        />
      </SettingsSection>
      <SettingsSection title="TABS.md file (legacy)">
        <SettingsSelect
          label="Workspace order"
          hint="How the workspace groups run when one TABS.md holds tabs from more than one workspace. Pick the order your Paseo sidebar uses. Pinned workspaces come first and archived ones last."
          value={values.workspaceOrder}
          options={ORDERS}
          disabled={settings.saving || !legacy}
          onValueChange={(workspaceOrder) => void save({ workspaceOrder })}
        />
        <SettingsSwitch
          label="Remove finished items"
          hint="A ticked item leaves TABS.md a day after it was ticked. The highest letter in each section stays, so a tab that follows the rule never reuses a letter."
          value={values.removeFinished}
          disabled={settings.saving || !legacy}
          onValueChange={(removeFinished) => void save({ removeFinished })}
        />
      </SettingsSection>
      <SettingsSection title="Panel colours">
        <SettingsSelect
          label="Palette"
          hint="Colours for the panel's dots and edges. TABS.md's dots are emoji, whose colours come from your font."
          value={values.palette}
          options={PALETTE_OPTIONS}
          disabled={settings.saving}
          onValueChange={(palette) => void save({ palette: palette as PaletteName })}
        />
      </SettingsSection>
    </ScrollView>
  );
}
