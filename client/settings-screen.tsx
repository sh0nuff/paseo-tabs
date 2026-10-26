import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
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

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(displaySettings);

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
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SettingsSection title="TABS.md and the panel">
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
