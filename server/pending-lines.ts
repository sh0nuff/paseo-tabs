// The Tabs panel rows and the sidebar line, worked out from the per-workspace
// pending store instead of TABS.md. Same shapes as listTabs and workspaceLines.
// Paseo's records give the tabs, their order, numbers and titles; the store
// gives each tab's items.

import type { TabLine } from "../shared/tabs-rpc.ts";
import { type PendingFile, type PendingItem, allFiles, readPending } from "./pending-store.ts";
import { type AgentRecord, loadState, type PaseoState } from "./paseo-state.ts";
import { cleanLine } from "./tabs-lines.ts";
import { DEFAULT_DISPLAY, type DisplayOptions, type TabEntry, type TabStatus, planFolder, shortAgentId } from "./tabs-file.ts";
import type { TabRow } from "./tabs-list.ts";

const DAY_MS = 24 * 3600 * 1000;
const RANK = { overdue: 0, waiting: 1, next: 2, done: 3 } as const;

interface Counts {
  waiting: number;
  next: number;
  overdue: number;
  status: Exclude<TabStatus, null>;
  /** The oldest open waiting item's text, or "". */
  oldest: string;
}

function countsFor(items: PendingItem[], now: Date, display: DisplayOptions): Counts {
  const open = items.filter((item) => item.status === "open");
  const waiting = open.filter((item) => item.kind === "waiting").sort((a, b) => Date.parse(a.changed) - Date.parse(b.changed));
  const next = open.filter((item) => item.kind === "next").length;
  const limit = display.overdueAfterDays * DAY_MS;
  const overdue = display.overdueAfterDays > 0 ? waiting.filter((item) => now.getTime() - Date.parse(item.changed) > limit).length : 0;
  const status = overdue > 0 ? "overdue" : waiting.length > 0 ? "waiting" : next > 0 ? "next" : "done";
  return { waiting: waiting.length, next, overdue, status, oldest: waiting[0]?.what ?? "" };
}

function safeItems(read: () => PendingFile[]): PendingFile[] {
  try {
    return read();
  } catch {
    return []; // a corrupt file is left untouched and shows nothing
  }
}

/** Paseo's ordering and numbering of tabs, with a section for each open tab and each closed tab that has items. */
function plan(state: PaseoState, cwd: string, hasItems: (agent: AgentRecord) => boolean, now: Date, display: DisplayOptions) {
  const agents = state.agents.filter((agent) => agent.cwd === cwd);
  const text = agents
    .filter((agent) => agent.archivedAt === null || hasItems(agent))
    .map((agent) => `## untitled · ${shortAgentId(agent.id)}\n\n`)
    .join("");
  return planFolder(text, agents, state.workspaces, now, display).groups;
}

export function storeTabRows(
  home: string,
  dir: string,
  workspaceId: string,
  now: Date = new Date(),
  display: DisplayOptions = DEFAULT_DISPLAY,
): TabRow[] {
  const state = loadState(home);
  const cwd =
    state.workspaces.find((workspace) => workspace.id === workspaceId)?.cwd ??
    state.agents.find((agent) => agent.workspaceId === workspaceId)?.cwd;
  if (!cwd) return [];
  const items = safeItems(() => [readPending(dir, workspaceId)])[0]?.items ?? [];
  const mine = (agent: AgentRecord) => items.filter((item) => item.agentId === agent.id);
  const group = plan(state, cwd, (agent) => mine(agent).length > 0, now, display).find((candidate) => candidate.id === workspaceId);
  if (!group) return [];
  return group.tabs.map((tab) => {
    const counts = countsFor(mine(tab.agent), now, display);
    return {
      agentId: tab.agent.id,
      short: tab.short,
      number: tab.number,
      title: tab.title,
      closed: tab.closed,
      waiting: counts.waiting,
      next: counts.next,
      overdue: counts.overdue,
      status: counts.status,
      about: "",
    };
  });
}

function rank(tab: TabEntry, counts: Map<string, Counts>): number {
  return RANK[counts.get(tab.agent.id)?.status ?? "done"];
}

export function storeLines(
  home: string,
  dir: string,
  now: Date = new Date(),
  display: DisplayOptions = DEFAULT_DISPLAY,
): Record<string, TabLine> {
  const state = loadState(home);
  const files = safeItems(() => allFiles(dir));
  const itemsOf = (workspaceId: string, agentId: string) =>
    files.filter((file) => file.workspaceId === workspaceId).flatMap((file) => file.items).filter((item) => item.agentId === agentId);
  const lines: Record<string, TabLine> = {};
  for (const cwd of new Set(state.agents.map((agent) => agent.cwd))) {
    for (const group of plan(state, cwd, () => false, now, display)) {
      const open = group.tabs.filter((tab) => !tab.closed);
      if (group.id === null || group.archived || open.length === 0) continue;
      const counts = new Map(open.map((tab) => [tab.agent.id, countsFor(itemsOf(group.id as string, tab.agent.id), now, display)]));
      const best = open.reduce((a, b) => {
        const order = rank(b, counts) - rank(a, counts);
        return order < 0 || (order === 0 && b.number > a.number) ? b : a;
      });
      const c = counts.get(best.agent.id)!;
      lines[group.id] = { status: c.status, title: best.title, waiting: cleanLine(c.oldest), more: open.length - 1 };
    }
  }
  return lines;
}
