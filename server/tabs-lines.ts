// What each workspace's row in Paseo's sidebar says: the workspace's most
// urgent open tab, its name, and the first item waiting on the user. It comes
// from the same reading of TABS.md that the Tabs panel uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TabLine } from "../shared/tabs-rpc.ts";
import { type ItemClock, waitingItems } from "./item-clock.ts";
import { loadState } from "./paseo-state.ts";
import { DEFAULT_DISPLAY, type DisplayOptions, type TabEntry, planFolder } from "./tabs-file.ts";

const MAX_WAITING = 160;
const RANK = { overdue: 0, waiting: 1, next: 2, done: 3 } as const;
// The "(about 10 min)" ending the rule asks tabs to add, and "(<App> task <id>)" links some tools add.
const ENDING = /\s*\((?:about\s+\d[^()]*|[A-Za-z][\w-]* task\s[^()]*)\)\s*$/i;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKUP = /\*\*|__|~~|`/g;

function readTabs(cwd: string): string | null {
  try {
    return readFileSync(join(cwd, "TABS.md"), "utf8");
  } catch {
    return null; // no TABS.md: this folder's workspaces get no line
  }
}

function rank(tab: TabEntry): number {
  return tab.status === null ? 4 : RANK[tab.status];
}

/** The most urgent of a workspace's open tabs, and on a tie the newest. */
function mostUrgent(open: TabEntry[]): TabEntry {
  return open.reduce((best, tab) => {
    const order = rank(tab) - rank(best);
    return order < 0 || (order === 0 && tab.number > best.number) ? tab : best;
  });
}

/** The first open item under "Waiting on you" as one plain line, without its endings, or "". */
export function firstWaiting(body: string): string {
  return cleanLine(waitingItems(body)[0]?.text ?? "");
}

/** One item's text as one plain line: endings, links and markup removed, long text cut. */
export function cleanLine(raw: string): string {
  let text = raw;
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(ENDING, "");
  }
  text = text.replace(LINK, "$1").replace(MARKUP, "").split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(text);
  return chars.length > MAX_WAITING ? `${chars.slice(0, MAX_WAITING - 1).join("")}…` : text;
}

/** One line for each workspace with an open tab in a TABS.md, keyed by workspace id. */
export function workspaceLines(
  home: string,
  now: Date = new Date(),
  display: DisplayOptions = DEFAULT_DISPLAY,
  clock?: ItemClock,
): Record<string, TabLine> {
  const state = loadState(home);
  const overdueOf = clock
    ? (short: string, body: string) => clock.overdueCount(short, body, now, display.overdueAfterDays)
    : undefined;
  const lines: Record<string, TabLine> = {};
  for (const cwd of new Set(state.agents.map((agent) => agent.cwd))) {
    const text = readTabs(cwd);
    if (text === null) continue;
    const agents = state.agents.filter((agent) => agent.cwd === cwd);
    const plan = planFolder(text, agents, state.workspaces, now, display, overdueOf);
    for (const group of plan.groups) {
      const open = group.tabs.filter((tab) => !tab.closed);
      if (group.id === null || group.archived || open.length === 0) continue;
      const tab = mostUrgent(open);
      lines[group.id] = { status: tab.status, title: tab.title, waiting: firstWaiting(tab.body), more: open.length - 1 };
    }
  }
  return lines;
}

/** compute's result, worked out again only once ms have passed since the last time. */
export function cachedFor<T>(ms: number, compute: () => T, clock: () => number = Date.now): () => T {
  let saved: { at: number; value: T } | null = null;
  return () => {
    const now = clock();
    // A clock set back would otherwise keep the old answer until it caught up again.
    if (saved === null || now < saved.at || now - saved.at >= ms) saved = { at: now, value: compute() };
    return saved.value;
  };
}
