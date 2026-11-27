// Archiving a workspace once nothing in it waits on the user, and finding tabs
// (active or archived by this plugin) to hand work to.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentRecord, type PaseoState, type WorkspaceRecord, loadState } from "./paseo-state.ts";
import { type ArchivedTab, STALE_MS, readRegistry, recordArchived, removeArchived } from "./archived-tabs.ts";
import { readActivity, recentDictation } from "./activity.ts";
import { readPending } from "./pending-store.ts";
import { type ControlRunner, archiveWorkspace } from "./workspace-control.ts";

export type AutoArchiveOptions = {
  agentId: string;
  dir: string;
  home: string;
  registry: string;
  runner: ControlRunner;
  now: Date;
  /** When the archive was scheduled: a user message to any tab after this means someone is there. */
  scheduledAt?: Date;
  /** How many times this archive was postponed already (0 for the first run). */
  attempt?: number;
  /** Schedules the same archive again 10 minutes later, as attempt N. Absent: a postponement is only reported. */
  postpone?: (attempt: number) => void;
};

export const MAX_POSTPONEMENTS = 6;
export const ACTIVITY_MS = 10 * 60_000;
export const DRAFT_MS = 3 * 60_000;
export const DICTATION_MS = 5 * 60_000;

/** Statuses of a tab that is not working: "closed" is an idle tab Paseo has unloaded. */
const RESTING = new Set(["idle", "closed"]);

/**
 * Checks again, at run time, that the agent's workspace still has no open items, that
 * every live tab in it is idle (or closed), that nobody messaged any of them since the
 * archive was scheduled, and that it is not archived yet; then records each tab in the
 * registry and archives it. Returns one line saying what it did or why not.
 */
export async function autoArchive(o: AutoArchiveOptions): Promise<string> {
  const state = loadState(o.home);
  const agent = state.agents.find((a) => a.id === o.agentId);
  const wsId = agent?.workspaceId;
  if (!agent || !wsId) return `auto-archive ${o.agentId}: no workspace, nothing done`;
  const ws = state.workspaces.find((w) => w.id === wsId);
  if (!ws) return `auto-archive ${wsId}: Paseo does not list the workspace, nothing done`;
  if (ws.archivedAt) return `auto-archive ${wsId}: already archived, nothing done`;
  const exempt = exemptReason(state, ws, scheduledAgents(o.home));
  if (exempt) return `auto-archive ${wsId}: ${exempt}, not archived`;
  const open = readPending(o.dir, wsId).items.filter((i) => i.status === "open");
  if (open.length > 0) return `auto-archive ${wsId}: ${open.length} open item(s), not archived`;
  const tabs = state.agents.filter((a) => a.workspaceId === wsId && !a.archivedAt);
  if (!tabs.some((a) => a.id === o.agentId)) tabs.push(agent);
  if (o.scheduledAt) {
    const since = o.scheduledAt.getTime();
    const busy = tabs.find((a) => a.lastUserMessageAt && Date.parse(a.lastUserMessageAt) > since);
    if (busy) return `auto-archive ${wsId}: tab ${busy.id} got a message after the archive was scheduled, not archived`;
  }
  const why = userBusy(o, tabs.map((a) => a.id));
  if (why) {
    const attempt = o.attempt ?? 0;
    if (attempt >= MAX_POSTPONEMENTS) return `auto-archive ${wsId}: ${why}; postponed ${MAX_POSTPONEMENTS} times already, giving up, not archived`;
    o.postpone?.(attempt + 1);
    return `auto-archive ${wsId}: ${why}; postponed 10 minutes (${attempt + 1} of ${MAX_POSTPONEMENTS})`;
  }
  const working = await notResting(tabs, o.runner);
  if (working) return `auto-archive ${wsId}: ${working}, not archived`;
  const failed = await archiveRecorded(ws, tabs, o);
  if (failed) return `auto-archive ${wsId}: ${failed}`;
  return `auto-archive ${wsId}: archived ("${ws.title ?? ""}", tab ${o.agentId})`;
}

/** "tab X is running" for the first tab whose status is not idle or closed (unknown counts as working), else null. */
export async function notResting(tabs: AgentRecord[], runner: ControlRunner): Promise<string | null> {
  for (const tab of tabs) {
    let status: string | null;
    try {
      status = await runner.agentStatus(tab.id);
    } catch {
      status = null;
    }
    if (status === null || !RESTING.has(status)) return `tab ${tab.id} is ${status ?? "unknown"}`;
  }
  return null;
}

/**
 * Records every tab in the registry, then archives the workspace. Returns null when it
 * went, else "archive failed...": on an error the entries stay only if Paseo shows it archived.
 */
export async function archiveRecorded(
  ws: WorkspaceRecord,
  tabs: AgentRecord[],
  o: { home: string; registry: string; runner: ControlRunner; now: Date },
): Promise<string | null> {
  const at = o.now.toISOString();
  recordArchived(
    o.registry,
    tabs.map((a) => ({ workspaceId: ws.id, workspaceName: ws.title ?? "", agentId: a.id, agentTitle: a.title ?? "", cwd: ws.cwd, archivedAt: at })),
    o.now,
  );
  try {
    await archiveWorkspace(ws.id, o.runner);
  } catch (error) {
    // A timeout may still have archived it: keep the entries unless Paseo shows it live.
    let archivedAnyway = false;
    try {
      archivedAnyway = isArchived(loadState(o.home), ws.id);
    } catch {
      // treat as not archived
    }
    if (!archivedAnyway) removeArchived(o.registry, [ws.id], o.now);
    const why = error instanceof Error ? error.message : String(error);
    return `archive failed${archivedAnyway ? " but Paseo shows it archived, entries kept" : ""}: ${why}`;
  }
  return null;
}

/** Schedule statuses that no longer run: a schedule in any other state keeps its agent's workspace open. */
const FINISHED_SCHEDULE = new Set(["completed", "expired"]);

/**
 * Agent id to schedule name, for every schedule or heartbeat in <paseoHome>/schedules that
 * targets an existing agent and has not completed or expired (active and paused both count).
 */
export function scheduledAgents(home: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(home, "schedules");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: { status?: unknown; name?: unknown; id?: unknown; target?: { type?: unknown; agentId?: unknown } };
    try {
      raw = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue; // caught mid-write
    }
    if (!raw || typeof raw.status !== "string" || FINISHED_SCHEDULE.has(raw.status)) continue;
    if (raw.target?.type !== "agent" || typeof raw.target.agentId !== "string") continue;
    out.set(raw.target.agentId, typeof raw.name === "string" ? raw.name : String(raw.id ?? name));
  }
  return out;
}

/**
 * The workspace's live tabs, plus any live subagent whose `paseo.parent-agent-id` points at
 * an agent of the workspace (archived or not), even when the subagent sits elsewhere.
 */
export function workspaceMembers(state: PaseoState, wsId: string): AgentRecord[] {
  const own = state.agents.filter((a) => a.workspaceId === wsId);
  const ids = new Set(own.map((a) => a.id));
  const members = own.filter((a) => !a.archivedAt);
  const seen = new Set(members.map((a) => a.id));
  for (const a of state.agents) {
    if (a.archivedAt || seen.has(a.id) || !a.parentAgentId || !ids.has(a.parentAgentId)) continue;
    members.push(a);
    seen.add(a.id);
  }
  return members;
}

/** Why this workspace must stay open whatever its items say (pinned, or a schedule targets one of its agents), or null. */
export function exemptReason(state: PaseoState, ws: WorkspaceRecord, schedules: Map<string, string>): string | null {
  if (ws.pinnedAt) return "pinned";
  const ids = new Set([...state.agents.filter((a) => a.workspaceId === ws.id).map((a) => a.id), ...workspaceMembers(state, ws.id).map((a) => a.id)]);
  for (const id of ids) {
    const name = schedules.get(id);
    if (name !== undefined) return `schedule "${name}" targets tab ${id}`;
  }
  return null;
}

/** Why the user looks present in this workspace right now (typing, an unsent draft, dictation), or null. */
function userBusy(o: AutoArchiveOptions, agentIds: string[]): string | null {
  const activity = readActivity(o.dir);
  const now = o.now.getTime();
  for (const id of agentIds) {
    const e = activity[id];
    const at = e ? Date.parse(e.at) : NaN;
    if (!Number.isFinite(at)) continue;
    if (e.draftLength > 0 && now - at < DRAFT_MS) return `tab ${id} has unsent text in its message box`;
    if (now - at < ACTIVITY_MS) return `tab ${id} had activity in its message box in the last 10 minutes`;
  }
  if (recentDictation(o.home, o.now, DICTATION_MS)) return "voice dictation in the last 5 minutes";
  return null;
}

export type FoundTab = {
  workspaceId: string;
  workspaceName: string;
  agentId: string | null;
  agentTitle: string;
  archived: boolean;
  archivedAt: string | null;
};

function matches(row: FoundTab, words: string[]): boolean {
  const text = `${row.workspaceName}\n${row.agentTitle}`.toLowerCase();
  return words.every((w) => text.includes(w) || (row.agentId ?? "").toLowerCase().startsWith(w) || row.workspaceId.toLowerCase().startsWith(w));
}

/**
 * Tabs whose workspace name or tab title holds every word, or whose agent or workspace
 * id starts with it: the live ones from Paseo's records, then the ones this plugin
 * archived. A registry entry whose workspace is live again is dropped from the registry.
 */
export function findTabs(state: PaseoState, registry: string, query: string, now: Date): FoundTab[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const live = new Set(state.workspaces.filter((w) => !w.archivedAt).map((w) => w.id));
  const rows: FoundTab[] = [];
  for (const ws of state.workspaces) {
    if (ws.archivedAt) continue;
    const tabs = state.agents.filter((a) => a.workspaceId === ws.id && !a.archivedAt);
    const base = { workspaceId: ws.id, workspaceName: ws.title ?? "", archived: false, archivedAt: null };
    if (tabs.length === 0) rows.push({ ...base, agentId: null, agentTitle: "" });
    for (const a of tabs) rows.push({ ...base, agentId: a.id, agentTitle: a.title ?? "" });
  }
  const entries: ArchivedTab[] = readRegistry(registry, now);
  const revived = entries.filter((e) => live.has(e.workspaceId)).map((e) => e.workspaceId);
  if (revived.length) removeArchived(registry, revived, now);
  for (const e of entries) {
    if (live.has(e.workspaceId)) continue;
    rows.push({ workspaceId: e.workspaceId, workspaceName: e.workspaceName, agentId: e.agentId, agentTitle: e.agentTitle, archived: true, archivedAt: e.archivedAt });
  }
  // Workspaces archived by hand are in Paseo's records but not the registry: search those too.
  const seen = new Set(rows.filter((r) => r.archived).map((r) => r.agentId));
  const recent = (iso: string | null) => {
    const at = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(at) && now.getTime() - at <= STALE_MS;
  };
  for (const ws of state.workspaces) {
    if (!ws.archivedAt || live.has(ws.id)) continue;
    for (const a of state.agents.filter((x) => x.workspaceId === ws.id)) {
      if (seen.has(a.id)) continue;
      const at = recent(ws.archivedAt) ? ws.archivedAt : recent(a.archivedAt) ? a.archivedAt : null;
      if (!at) continue;
      seen.add(a.id);
      rows.push({ workspaceId: ws.id, workspaceName: ws.title ?? "", agentId: a.id, agentTitle: a.title ?? "", archived: true, archivedAt: at });
    }
  }
  return rows.filter((r) => matches(r, words));
}

/** True when Paseo's records show this workspace archived. */
export function isArchived(state: PaseoState, workspaceId: string): boolean {
  return !!state.workspaces.find((w) => w.id === workspaceId)?.archivedAt;
}
