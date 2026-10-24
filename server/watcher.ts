// The plugin's background loop. Paseo has no event for a renamed or brought-back
// tab, so this checks Paseo's files every couple of seconds and syncs every
// folder whenever any of them changed.

import { syncFolder } from "./folder-sync.ts";
import { loadState, stateFingerprint } from "./paseo-state.ts";

export function syncAll(home: string, now: Date = new Date()): Record<string, string> {
  const state = loadState(home);
  const results: Record<string, string> = {};
  for (const cwd of new Set(state.agents.map((agent) => agent.cwd))) {
    try {
      results[cwd] = syncFolder(cwd, state, now);
    } catch (error) {
      results[cwd] = "error";
      console.error(`paseo-tabs: could not sync ${cwd}:`, error);
    }
  }
  return results;
}

export function startWatcher(home: string, intervalMs = 2000): () => void {
  let seen: string | null = null;
  const tick = () => {
    try {
      const fingerprint = stateFingerprint(home);
      if (fingerprint === seen) return;
      seen = fingerprint;
      syncAll(home);
    } catch (error) {
      console.error("paseo-tabs: sync pass failed:", error);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
