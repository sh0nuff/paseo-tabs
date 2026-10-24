import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type DisplayValues, displaySettings } from "../shared/settings.ts";

const MIN_LENGTH = 20;
const MAX_LENGTH = 80;
const STEP = 5;

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(displaySettings);

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: 18 },
      item: { gap: 6 },
      head: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 12 },
      name: { color: theme.colors.foreground, fontSize: 16, flexShrink: 1 },
      help: { color: theme.colors.foregroundMuted, fontSize: 13 },
      pill: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border },
      pillOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      pillText: { color: theme.colors.foreground, fontSize: 14 },
      pillTextOn: { color: theme.colors.accentForeground },
      stepper: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      step: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center" as const, justifyContent: "center" as const },
      value: { color: theme.colors.foreground, fontSize: 16, minWidth: 28, textAlign: "center" as const },
      message: { color: theme.colors.foregroundMuted, fontSize: 14 },
      error: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  if (settings.status === "loading") return <Note style={styles} text="Loading settings…" />;
  if (settings.status === "error" || settings.status === "invalid") {
    return <Note style={styles} text={`Couldn't read the settings: ${settings.error}`} />;
  }

  const values = settings.values;
  const save = (change: Partial<DisplayValues>) => void settings.save({ ...values, ...change }, settings.revision);

  const toggle = (on: boolean, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={settings.saving}
      style={[styles.pill, on ? styles.pillOn : null]}
    >
      <Text style={[styles.pillText, on ? styles.pillTextOn : null]}>{on ? "On" : "Off"}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.item}>
        <View style={styles.head}>
          <Text style={styles.name}>Status dots</Text>
          {toggle(values.statusDots, "Status dots", () => save({ statusDots: !values.statusDots }))}
        </View>
        <Text style={styles.help}>
          A dot before each tab in TABS.md and the panel: orange when something waits on you, blue when only Claude has
          next steps, a tick when nothing is open.
        </Text>
      </View>

      <View style={styles.item}>
        <View style={styles.head}>
          <Text style={styles.name}>Shorten long names</Text>
          {toggle(values.shortenNames, "Shorten long names", () => save({ shortenNames: !values.shortenNames }))}
        </View>
        <Text style={styles.help}>
          Long tab and workspace names, often a copy of a first message, are shown shorter: stray quotes and openers go,
          the first clause stays, and an ellipsis marks a cut. The names in Paseo stay as they are.
        </Text>
      </View>

      <View style={styles.item}>
        <View style={styles.head}>
          <Text style={styles.name}>Longest name</Text>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Shorter"
              disabled={settings.saving || values.maxNameLength <= MIN_LENGTH}
              onPress={() => save({ maxNameLength: Math.max(MIN_LENGTH, values.maxNameLength - STEP) })}
              style={styles.step}
            >
              <Text style={styles.value}>−</Text>
            </Pressable>
            <Text style={styles.value}>{values.maxNameLength}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Longer"
              disabled={settings.saving || values.maxNameLength >= MAX_LENGTH}
              onPress={() => save({ maxNameLength: Math.min(MAX_LENGTH, values.maxNameLength + STEP) })}
              style={styles.step}
            >
              <Text style={styles.value}>+</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.help}>Characters before a name is cut, when shortening is on.</Text>
      </View>

      {settings.saveError ? <Text style={styles.error}>{`Couldn't save: ${settings.saveError}`}</Text> : null}
    </ScrollView>
  );
}

function Note({ style, text }: { style: { screen: object; content: object; message: object }; text: string }) {
  return (
    <View style={[style.screen, style.content]}>
      <Text style={style.message}>{text}</Text>
    </View>
  );
}
