// The record of workspaces this plugin archived by itself, so any tab can find a
// workspace to hand work to. One JSON file, ${state}/paseo-tabs/archived-tabs.json,
// written under the same lock-and-rename scheme as the pending store. Entries older
// than 30 days are dropped on every read and write; an entry goes when its workspace
// is restored.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { withLock } from "./pending-store.ts";

export type ArchivedTab = {
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentTitle: string;
  cwd: string;
  archivedAt: string;
};

export const STALE_MS = 30 * 24 * 3600 * 1000;

export function registryPath(env: Record<string, string | undefined>): string {
  const state = env.XDG_STATE_HOME || join(env.HOME ?? homedir(), ".local", "state");
  return join(state, "paseo-tabs", "archived-tabs.json");
}

function fresh(entries: ArchivedTab[], now: Date): ArchivedTab[] {
  return entries.filter((e) => {
    const at = Date.parse(e.archivedAt);
    return Number.isFinite(at) && now.getTime() - at <= STALE_MS;
  });
}

function readRaw(path: string): ArchivedTab[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return []; // missing or unreadable: start over
  }
}

function write(path: string, entries: ArchivedTab[]): void {
  const scratch = `${path}.${process.pid}.tmp`;
  writeFileSync(scratch, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
  renameSync(scratch, path);
}

function mutate<T>(path: string, now: Date, change: (entries: ArchivedTab[]) => { entries: ArchivedTab[]; result: T }): T {
  return withLock(path, () => {
    const before = readRaw(path);
    const { entries, result } = change(fresh(before, now));
    write(path, entries);
    return result;
  });
}

/** Entries no older than 30 days. Drops the stale ones from the file when there are any. */
export function readRegistry(path: string, now: Date): ArchivedTab[] {
  const all = readRaw(path);
  const kept = fresh(all, now);
  if (kept.length !== all.length) return mutate(path, now, (entries) => ({ entries, result: entries }));
  return kept;
}

/** Records an archived workspace, replacing any earlier entry for the same workspace. */
export function recordArchived(path: string, entry: ArchivedTab, now: Date): void {
  mutate(path, now, (entries) => ({ entries: [...entries.filter((e) => e.workspaceId !== entry.workspaceId), entry], result: undefined }));
}

/** Drops the entries for these workspaces. Returns how many went. Leaves the file alone when none match. */
export function removeArchived(path: string, workspaceIds: string[], now: Date): number {
  const ids = new Set(workspaceIds);
  if (!readRaw(path).some((e) => ids.has(e.workspaceId))) return 0;
  return mutate(path, now, (entries) => {
    const kept = entries.filter((e) => !ids.has(e.workspaceId));
    return { entries: kept, result: entries.length - kept.length };
  });
}
