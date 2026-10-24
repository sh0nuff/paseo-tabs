// The plugin's background loop. Paseo has no event for a renamed or brought-back
// tab, so this checks Paseo's files every couple of seconds, along with each
// TABS.md it keeps, and syncs every folder whenever any of them changed, or
// when the display settings change.

import { statSync } from "node:fs";
import { join } from "node:path";
import { syncFolder } from "./folder-sync.ts";
import { loadState, stateFingerprint } from "./paseo-state.ts";
import { DEFAULT_DISPLAY, type DisplayOptions } from "./tabs-file.ts";

export function syncAll(home: string, now: Date = new Date(), display: DisplayOptions = DEFAULT_DISPLAY): Record<string, string> {
  const state = loadState(home);
  const results: Record<string, string> = {};
  for (const cwd of new Set(state.agents.map((agent) => agent.cwd))) {
    try {
      results[cwd] = syncFolder(cwd, state, now, undefined, display);
    } catch (error) {
      results[cwd] = "error";
      console.error(`paseo-tabs: could not sync ${cwd}:`, error);
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
  { intervalMs = 2000, display = () => DEFAULT_DISPLAY }: { intervalMs?: number; display?: () => DisplayOptions } = {},
): Watcher {
  let seen: string | null = null;
  let folders: string[] = [];
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
      if (!force && current === seen) return;
      seen = current;
      folders = Object.keys(syncAll(home, new Date(), display()));
    } catch (error) {
      console.error("paseo-tabs: sync pass failed:", error);
    }
  };
  tick(true);
  const timer = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(timer), refresh: () => tick(true) };
}
