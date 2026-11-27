// What the app reports about a user typing in a tab's message box, and a best-effort
// check for voice dictation in the daemon log. Auto-archive reads both.

import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withLock } from "./pending-store.ts";

export type ActivityEntry = { at: string; draftLength: number };
export type ActivityMap = Record<string, ActivityEntry>;

const KEEP_MS = 24 * 3600 * 1000;
const TAIL_BYTES = 512 * 1024;

/** `${state}/paseo-tabs/activity.json`, next to the pending store directory. */
export function activityPath(pendingDir: string): string {
  return join(dirname(pendingDir), "activity.json");
}

export function readActivity(pendingDir: string): ActivityMap {
  try {
    const data = JSON.parse(readFileSync(activityPath(pendingDir), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as ActivityMap) : {};
  } catch {
    return {};
  }
}

/** Stores the agent's latest activity under the store's lock, dropping entries older than a day. */
export function recordActivity(pendingDir: string, agentId: string, draftLength: number, now: Date): void {
  const path = activityPath(pendingDir);
  mkdirSync(dirname(path), { recursive: true });
  withLock(path, () => {
    const map = readActivity(pendingDir);
    for (const [id, e] of Object.entries(map)) {
      if (!e || !(now.getTime() - Date.parse(e.at) < KEEP_MS)) delete map[id];
    }
    map[agentId] = { at: now.toISOString(), draftLength: Math.max(0, Math.floor(draftLength) || 0) };
    const scratch = `${path}.${process.pid}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
    renameSync(scratch, path);
  });
}

export function pendingActivityHandler(pendingDir: string, agentId: string, draftLength: number, now: Date): { ok: boolean } {
  recordActivity(pendingDir, agentId, draftLength, now);
  return { ok: true };
}

/**
 * True when the tail of `<paseoHome>/daemon.log` holds a JSON line, timed within the window,
 * that mentions dictation_stream (ws_runtime_metrics lines list it under
 * inboundSessionRequestTypesTop). Global, not per workspace. Any problem reads as false.
 */
export function recentDictation(paseoHome: string, now: Date, windowMs: number): boolean {
  const path = join(paseoHome, "daemon.log");
  let text: string;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buf, 0, buf.length, start);
    } finally {
      closeSync(fd);
    }
    text = buf.toString("utf8");
  } catch {
    return false;
  }
  const since = now.getTime() - windowMs;
  for (const line of text.split("\n")) {
    if (!line.includes("dictation_stream")) continue;
    try {
      const time = Number(JSON.parse(line).time);
      if (Number.isFinite(time) && time >= since && time <= now.getTime() + 60_000) return true;
    } catch {
      // a cut first line or plain text
    }
  }
  return false;
}
