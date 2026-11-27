// The daemon's sweep: every 5 minutes, archive each workspace that had items waiting on
// the user, has none open now, and has been quiet for 10 minutes. It covers the tabs the
// Stop hook never reaches, because Claude Code loads plugin hooks only when a tab starts.
//
// A workspace is archived when all of these hold:
//   - it is not archived, not pinned, and no live schedule or heartbeat targets its agents;
//   - its pending file has at least one item, and none of them is open;
//   - nothing moved for 10 minutes: its agents' records (last message, last update, last
//     activity), its items (made, changed, done) and the message-box activity the app reports;
//     an unsent draft in the last 3 minutes or voice dictation in the last 5 also block;
//   - every live tab, and every live subagent started from one, is idle or closed.

import { readActivity, recentDictation } from "./activity.ts";
import { ACTIVITY_MS, DICTATION_MS, DRAFT_MS, archiveRecorded, exemptReason, notResting, scheduledAgents, workspaceMembers } from "./auto-archive.ts";
import { type PaseoState, type WorkspaceRecord, loadState } from "./paseo-state.ts";
import { readPending } from "./pending-store.ts";
import type { ControlRunner } from "./workspace-control.ts";

export const SWEEP_INTERVAL_MS = 5 * 60_000;

export type SweepOptions = {
  home: string;
  dir: string;
  registry: string;
  runner: ControlRunner;
  now: Date;
  /** Decide only: archive nothing and write nothing. */
  dryRun: boolean;
};

export type SweepDecision = {
  workspaceId: string;
  name: string;
  /** "archive" when it was (or, in a dry run, would be) archived; "failed" when the archive errored. */
  action: "archive" | "skip" | "failed";
  reason: string;
};

function newest(times: (string | null | undefined)[]): number {
  let best = -Infinity;
  for (const t of times) {
    const at = t ? Date.parse(t) : NaN;
    if (Number.isFinite(at) && at > best) best = at;
  }
  return best;
}

/** The reason to leave this workspace open that needs no Paseo call, or null when only the status check is left. */
function quickReason(o: SweepOptions, state: PaseoState, ws: WorkspaceRecord, schedules: Map<string, string>, dictation: boolean): string | null {
  const exempt = exemptReason(state, ws, schedules);
  if (exempt) return exempt;
  let items;
  try {
    items = readPending(o.dir, ws.id).items;
  } catch (error) {
    return `pending file unreadable: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (items.length === 0) return "never had items";
  const open = items.filter((i) => i.status === "open").length;
  if (open > 0) return `${open} open item(s)`;
  const members = workspaceMembers(state, ws.id);
  const now = o.now.getTime();
  const activity = readActivity(o.dir);
  for (const a of members) {
    const e = activity[a.id];
    const at = e ? Date.parse(e.at) : NaN;
    if (e && e.draftLength > 0 && now - at < DRAFT_MS) return `tab ${a.id} has unsent text in its message box`;
  }
  if (dictation) return "voice dictation in the last 5 minutes";
  const last = newest([
    ...members.flatMap((a) => [a.lastUserMessageAt, a.updatedAt, a.lastActivityAt]),
    ...items.flatMap((i) => [i.created, i.changed, i.done]),
    ...members.map((a) => activity[a.id]?.at),
  ]);
  if (now - last < ACTIVITY_MS) return `activity ${Math.max(0, Math.round((now - last) / 60_000))} minute(s) ago`;
  return null;
}

/** Decides, and unless dry-running archives, every live workspace. One decision each, in Paseo's order. */
export async function sweep(o: SweepOptions): Promise<SweepDecision[]> {
  const state = loadState(o.home);
  const schedules = scheduledAgents(o.home);
  const dictation = recentDictation(o.home, o.now, DICTATION_MS);
  const out: SweepDecision[] = [];
  for (const ws of state.workspaces) {
    if (ws.archivedAt) continue;
    const name = ws.title ?? "";
    const skip = (reason: string) => out.push({ workspaceId: ws.id, name, action: "skip", reason });
    const quick = quickReason(o, state, ws, schedules, dictation);
    if (quick) {
      skip(quick);
      continue;
    }
    const working = await notResting(workspaceMembers(state, ws.id), o.runner);
    if (working) {
      skip(working);
      continue;
    }
    if (o.dryRun) {
      out.push({ workspaceId: ws.id, name, action: "archive", reason: "would archive (dry run)" });
      continue;
    }
    // Read again just before acting: a tab may have been messaged while the statuses were read.
    const fresh = loadState(o.home);
    const now = fresh.workspaces.find((w) => w.id === ws.id);
    if (!now || now.archivedAt) {
      skip("archived meanwhile");
      continue;
    }
    const again = quickReason({ ...o, now: new Date() }, fresh, now, scheduledAgents(o.home), dictation);
    if (again) {
      skip(again);
      continue;
    }
    const tabs = fresh.agents.filter((a) => a.workspaceId === ws.id && !a.archivedAt);
    const failed = await archiveRecorded(now, tabs, o);
    out.push(failed ? { workspaceId: ws.id, name, action: "failed", reason: failed } : { workspaceId: ws.id, name, action: "archive", reason: "archived" });
  }
  return out;
}

/** One line for a decision: `archive wks_... "Name": reason`. */
export function decisionLine(d: SweepDecision): string {
  return `${d.action} ${d.workspaceId} "${d.name}": ${d.reason}`;
}

export type Timers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

/**
 * Runs `run` every intervalMs. A tick while the last run is still going is skipped, and
 * nothing runs after stop(). tick() runs once now and resolves false when it was skipped.
 */
export function startSweeper(run: () => Promise<void>, intervalMs = SWEEP_INTERVAL_MS, timers: Timers = globalThis as unknown as Timers) {
  let running = false;
  let stopped = false;
  const tick = async (): Promise<boolean> => {
    if (running || stopped) return false;
    running = true;
    try {
      await run();
    } catch (error) {
      console.error("paseo-tabs: sweep failed:", error);
    } finally {
      running = false;
    }
    return true;
  };
  const handle = timers.setInterval(() => void tick(), intervalMs);
  (handle as { unref?: () => void } | null)?.unref?.();
  return {
    tick,
    stop: () => {
      stopped = true;
      timers.clearInterval(handle);
    },
  };
}
