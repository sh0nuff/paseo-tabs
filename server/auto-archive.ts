// Archiving a workspace once nothing in it waits on the user, and finding tabs
// (active or archived by this plugin) to hand work to.

import { type PaseoState, loadState } from "./paseo-state.ts";
import { type ArchivedTab, readRegistry, recordArchived, removeArchived } from "./archived-tabs.ts";
import { readPending } from "./pending-store.ts";
import { type ControlRunner, archiveWorkspace } from "./workspace-control.ts";

export type AutoArchiveOptions = {
  agentId: string;
  dir: string;
  home: string;
  registry: string;
  runner: ControlRunner;
  now: Date;
};

/**
 * Checks again, at run time, that the agent's workspace still has no open items, that
 * every live tab in it is idle and that it is not archived yet; then records it in the
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
  const open = readPending(o.dir, wsId).items.filter((i) => i.status === "open");
  if (open.length > 0) return `auto-archive ${wsId}: ${open.length} open item(s), not archived`;
  const tabs = state.agents.filter((a) => a.workspaceId === wsId && !a.archivedAt);
  if (!tabs.some((a) => a.id === o.agentId)) tabs.push(agent);
  for (const tab of tabs) {
    let status: string | null;
    try {
      status = await o.runner.agentStatus(tab.id);
    } catch {
      status = null;
    }
    if (status !== "idle") return `auto-archive ${wsId}: tab ${tab.id} is ${status ?? "unknown"}, not archived`;
  }
  recordArchived(
    o.registry,
    { workspaceId: wsId, workspaceName: ws.title ?? "", agentId: o.agentId, agentTitle: agent.title ?? "", cwd: ws.cwd, archivedAt: o.now.toISOString() },
    o.now,
  );
  try {
    await archiveWorkspace(wsId, o.runner);
  } catch (error) {
    removeArchived(o.registry, [wsId], o.now);
    return `auto-archive ${wsId}: archive failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `auto-archive ${wsId}: archived ("${ws.title ?? ""}", tab ${o.agentId})`;
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
  return rows.filter((r) => matches(r, words));
}

/** True when Paseo's records show this workspace archived. */
export function isArchived(state: PaseoState, workspaceId: string): boolean {
  return !!state.workspaces.find((w) => w.id === workspaceId)?.archivedAt;
}
