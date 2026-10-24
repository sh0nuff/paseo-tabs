// What the Tabs panel shows for one workspace: its tabs in tab-bar order, with
// how many items are open in each tab's section of TABS.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadState } from "./paseo-state.ts";
import { countOpen, planFolder } from "./tabs-file.ts";

export interface TabRow {
  agentId: string;
  short: string;
  number: number;
  title: string;
  closed: boolean;
  waiting: number;
  next: number;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return ""; // no TABS.md: open tabs are still listed, with no counts
  }
}

export function listTabs(home: string, workspaceId: string, now: Date = new Date()): TabRow[] {
  const state = loadState(home);
  const cwd =
    state.workspaces.find((workspace) => workspace.id === workspaceId)?.cwd ??
    state.agents.find((agent) => agent.workspaceId === workspaceId)?.cwd;
  if (!cwd) return [];

  const agents = state.agents.filter((agent) => agent.cwd === cwd);
  const plan = planFolder(readText(join(cwd, "TABS.md")), agents, state.workspaces, now);
  const group = plan.groups.find((candidate) => candidate.id === workspaceId);
  if (!group) return [];

  return group.tabs.map((tab) => ({
    agentId: tab.agent.id,
    short: tab.short,
    number: tab.number,
    title: tab.title,
    closed: tab.closed,
    waiting: countOpen(tab.body, "Waiting on you"),
    next: countOpen(tab.body, "Claude's next steps"),
  }));
}
