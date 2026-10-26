// The plugin's background loop. Paseo has no event for a renamed or brought-back
// tab, so this checks Paseo's files every couple of seconds, along with each
// TABS.md it keeps, and syncs every folder whenever any of them changed, when
// the display settings change, or when a waiting item reaches the overdue limit.

import { statSync } from "node:fs";
import { join } from "node:path";
import { syncFolder } from "./folder-sync.ts";
import type { ItemClock } from "./item-clock.ts";
import { loadState, stateFingerprint } from "./paseo-state.ts";
import { DEFAULT_DISPLAY, type DisplayOptions, shortAgentId } from "./tabs-file.ts";

export function syncAll(
  home: string,
  now: Date = new Date(),
  display: DisplayOptions = DEFAULT_DISPLAY,
  clock?: ItemClock,
): Record<string, string> {
  const state = loadState(home);
  const overdueOf = clock
    ? (short: string, body: string) => clock.observe(short, body, now, display.overdueAfterDays)
    : undefined;
  const results: Record<string, string> = {};
  for (const cwd of new Set(state.agents.map((agent) => agent.cwd))) {
    try {
      results[cwd] = syncFolder(cwd, state, now, undefined, display, overdueOf);
    } catch (error) {
      results[cwd] = "error";
      console.error(`paseo-tabs: could not sync ${cwd}:`, error);
    }
  }
  if (clock) {
    // Forget only tabs Paseo no longer has, so a folder skipped or busy this pass keeps its clocks.
    // An empty list more likely means Paseo's files could not be read than that every tab is gone.
    if (state.agents.length > 0) clock.prune(new Set(state.agents.map((agent) => shortAgentId(agent.id))));
    try {
      clock.save();
    } catch (error) {
      console.error("paseo-tabs: could not save item ages:", error);
    }
  }
  return results;
}

export interface Watcher {
  stop(): void;
  /** Sync every folder now, for example after the display settings changed. */
  refresh(): void;
}

export function startWatcher(
  home: string,
  {
    intervalMs = 2000,
    display = () => DEFAULT_DISPLAY,
    clock,
  }: { intervalMs?: number; display?: () => DisplayOptions; clock?: ItemClock } = {},
): Watcher {
  let seen: string | null = null;
  let folders: string[] = [];
  let due: number | null = null;
  // A tab editing its section changes TABS.md and nothing of Paseo's, so the
  // files themselves are part of what is watched. This pass's own write shows up
  // as one more change, whose pass then finds nothing to do.
  const fingerprint = () => {
    const parts = [stateFingerprint(home)];
    for (const cwd of folders) {
      try {
        const info = statSync(join(cwd, "TABS.md"));
        parts.push(`${cwd}:${info.mtimeMs}:${info.size}`);
      } catch {
        parts.push(`${cwd}:none`);
      }
    }
    return parts.join("\n");
  };
  const tick = (force = false) => {
    try {
      const current = fingerprint();
      // An item turning overdue changes no file, so its moment is watched as well.
      const overdueNow = due !== null && Date.now() > due;
      if (!force && !overdueNow && current === seen) return;
      seen = current;
      const now = new Date();
      const options = display();
      folders = Object.keys(syncAll(home, now, options, clock));
      due = clock?.nextDue(options.overdueAfterDays, now.getTime()) ?? null;
    } catch (error) {
      console.error("paseo-tabs: sync pass failed:", error);
    }
  };
  tick(true);
  const timer = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(timer), refresh: () => tick(true) };
}
