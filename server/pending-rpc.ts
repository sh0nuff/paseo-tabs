// Handlers behind the Pending panel's RPCs. The store directory and Paseo home
// are parameters so tests can point them at temp dirs.

import type { PendingCard } from "../shared/pending-rpc.ts";
import { loadState } from "./paseo-state.ts";
import { autoArchiveFor, cutoverPath, modeFor, type SavedSettings } from "../lib/install-state.mjs";
import { allFiles, clearPicked, readPending, setPicked, type PendingItem } from "./pending-store.ts";

function toCard(item: PendingItem): PendingCard {
  const { agentId, letter, what, action, minutes, why, picked, status, created } = item;
  return { agentId, letter, what, action, minutes, why, created, picked, status };
}

function sentence(text: string, fallback: string): string {
  const t = text.trim() || fallback;
  return t.replace(/\.+$/, "");
}

export function pickMessage(card: PendingCard): string {
  return (
    `Picked from the panel: ${sentence(card.what, "untitled")}. ` +
    `Action: ${sentence(card.action, "ask the tab")}. ` +
    `About ${card.minutes} min. ` +
    `Why: ${sentence(card.why, "not given")}. (item ${card.letter})`
  );
}

export function doneMessage(card: PendingCard): string {
  return `Done from the panel: ${sentence(card.what, "untitled")}. The user says this is finished. (item ${card.letter})`;
}

function byCreated(a: PendingItem, b: PendingItem): number {
  return Date.parse(a.created) - Date.parse(b.created);
}

function openWaiting(items: PendingItem[]): PendingItem[] {
  return items.filter((i) => i.kind === "waiting" && i.status === "open").sort(byCreated);
}

export function pendingListHandler(dir: string, workspaceId: string): { items: PendingCard[] } {
  return { items: openWaiting(readPending(dir, workspaceId).items).map(toCard) };
}

export function pendingPickHandler(dir: string, workspaceId: string, agentId: string, letter: string, now: Date, done = false): { message: string } {
  const item = setPicked(dir, workspaceId, agentId, letter, now);
  return { message: done ? doneMessage(toCard(item)) : pickMessage(toCard(item)) };
}

export function pendingUnpickHandler(dir: string, workspaceId: string, agentId: string, letter: string): { ok: boolean } {
  clearPicked(dir, workspaceId, agentId, letter);
  return { ok: true };
}

/** The marker a 1.x cut-over leaves in the store directory; the hooks read the same path. */
export function cutoverMarker(dir: string): string {
  return cutoverPath(dir);
}

/**
 * True when the pending store is the source (mode "pending"), checked at use time: the
 * cut-over marker, the saved mode, the old pendingStore switch, else no 1.x history.
 */
export function storeMode(display: SavedSettings, dir: string): boolean {
  return modeFor(dir, display) === "pending";
}

/** The mode and auto-archive in force, for the panel and the settings screen. */
export function pendingEnabledHandler(dir: string, display: SavedSettings = {}) {
  const mode = modeFor(dir, display);
  return { enabled: mode === "pending", mode, autoArchive: autoArchiveFor(dir, display) };
}

export function pendingSearchHandler(dir: string, home: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { hits: [] };
  const names = new Map(loadState(home).workspaces.map((w) => [w.id, w.title ?? w.id]));
  const hits = [];
  for (const file of allFiles(dir)) {
    for (const item of openWaiting(file.items)) {
      if ([item.what, item.action, item.why].some((f) => f.toLowerCase().includes(needle))) {
        hits.push({ workspaceId: file.workspaceId, workspaceName: names.get(file.workspaceId) ?? file.workspaceId, card: toCard(item) });
      }
    }
  }
  return { hits };
}
