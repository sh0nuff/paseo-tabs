// The TABS.md format: one section per tab, grouped by Paseo workspace.
//
// A tab's heading is "## <dot> <n>. <title> · <first 7 characters of its agent
// id>", with " · closed" once the tab is archived. The dot shows where the tab
// stands: red when an item has waited on the user past their limit, orange when
// something waits on them, blue when only Claude has next steps, a tick when
// nothing is open, and none for a new or closed tab. n is the tab's place in its
// workspace's tab bar, in the order the tabs were opened, and closed tabs carry
// on after the open ones. When a file holds tabs from more than one workspace,
// each workspace's sections sit under "# <workspace title> · <7 characters of
// its id>". This module owns headings, group lines and section order. Each
// tab owns the text under its own heading, which is never changed here.
//
// A closed tab's section stays while anything in it is open. It goes once
// nothing is open and the tab has been closed for 24 hours.

import { shortenName } from "./names.ts";
import type { AgentRecord, WorkspaceRecord } from "./paseo-state.ts";

export const PLACEHOLDER = "No items yet. This tab hasn't written to this file.";

const TAB_HEADING = /^## (?:(?:🔴|🟠|🔵|✅) )?(?:\d+\. )?(.*?) · ([0-9A-Za-z]{7})( · closed)?[ \t]*$/u;
const GROUP_LINE = /^# (.*?) · ([0-9A-Za-z]{7})( · archived)?[ \t]*$/;
const BULLET = /^\s*[-*+] /;
const DONE_ITEM = /^\s*[-*+] (?:[a-z]+\) )?\[x\] /;
const NOTHING_ITEM = /^\s*[-*+] Nothing/;
const LABEL = /^\*\*.+\*\*\s*$/;
const SECTION_LABELS = /^\*\*(?:Waiting on you|Claude's next steps|Done)\*\*\s*$/m;
const DOTS = { overdue: "🔴", waiting: "🟠", next: "🔵", done: "✅" } as const;
const KEEP_CLOSED_MS = 24 * 3600 * 1000;
const NO_WORKSPACE_SHORT = "0000000";

/** How TABS.md is shown. These are the plugin's settings in Paseo. */
export interface DisplayOptions {
  statusDots: boolean;
  shortenNames: boolean;
  maxNameLength: number;
  /** Days an item may wait on the user unchanged before its tab turns red. 0 means never. */
  overdueAfterDays: number;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  statusDots: true,
  shortenNames: true,
  maxNameLength: 40,
  overdueAfterDays: 7,
};

/** null for a section with none of the usual labels yet, such as a new tab's placeholder. */
export type TabStatus = "overdue" | "waiting" | "next" | "done" | null;

export interface TabEntry {
  agent: AgentRecord;
  short: string;
  /** Paseo's name for the tab, else the name in its heading, else "untitled", shortened if set. */
  title: string;
  number: number;
  closed: boolean;
  status: TabStatus;
  /** Items waiting on the user past the limit, from the clock passed to planFolder. */
  overdue: number;
  body: string;
}

export interface WorkspaceGroup {
  id: string | null;
  short: string;
  title: string;
  archived: boolean;
  tabs: TabEntry[];
}

export interface FolderPlan {
  preamble: string;
  groups: WorkspaceGroup[];
  unknown: string[];
  dots: boolean;
}

export function shortAgentId(id: string): string {
  return id.slice(0, 7);
}

export function shortWorkspaceId(id: string): string {
  return id.replace(/^wks_/, "").slice(0, 7);
}

function oneLine(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

// Paseo's name for the tab, shortened for display if set. With no name in Paseo,
// the heading itself is the only copy of the name, so it is kept whole.
function resolveTitle(
  agent: AgentRecord,
  headingTitle: string | undefined,
  display: (name: string) => string,
): string {
  if (oneLine(agent.title ?? "")) return display(agent.title ?? "");
  return oneLine(headingTitle ?? "") || "untitled";
}

// This guards the one path that removes text, so it leans towards "open": any
// unticked box counts, at any indent, as does any list line that isn't ticked.
export function isOpenItem(line: string): boolean {
  if (line.includes("[ ]")) return true;
  return BULLET.test(line) && !DONE_ITEM.test(line) && !NOTHING_ITEM.test(line);
}

/** True if any list line in a section is not ticked. Unusual lines count as open. */
export function hasOpenItems(body: string): boolean {
  return body.split("\n").some(isOpenItem);
}

/** The first line under a section's "### About this tab", or "". */
export function aboutLine(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === "### About this tab");
  if (start === -1) return "";
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#") || LABEL.test(line) || line.startsWith("Last updated")) return "";
    if (line.trim()) return line.trim().replace(/^[-*+]\s+/, "");
  }
  return "";
}

/** Where a tab stands, from its own section and how many of its items are overdue. */
export function tabStatus(body: string, overdue = 0): TabStatus {
  if (!SECTION_LABELS.test(body)) return null;
  if (overdue > 0) return "overdue";
  if (countOpen(body, "Waiting on you") > 0) return "waiting";
  if (countOpen(body, "Claude's next steps") > 0) return "next";
  // A tick must never sit over an unticked box, wherever in the section it is.
  if (body.includes("[ ]")) return "next";
  return "done";
}

/** Open items under one bold label, up to the next label. */
export function countOpen(body: string, label: "Waiting on you" | "Claude's next steps"): number {
  let inside = false;
  let count = 0;
  for (const line of body.split("\n")) {
    if (LABEL.test(line)) {
      inside = line.trim() === `**${label}**`;
      continue;
    }
    if (inside && isOpenItem(line)) count++;
  }
  return count;
}

interface Section {
  heading: string;
  body: string;
}

function startsSection(line: string): boolean {
  return line.startsWith("## ") || GROUP_LINE.test(line);
}

/** The text before the first heading, and each section with its heading line. */
function splitSections(text: string): { preamble: string; sections: Section[] } {
  const lines = text.split("\n");
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (startsSection(line)) starts.push(index);
  });
  if (starts.length === 0) return { preamble: text, sections: [] };
  const sections = starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    return { heading: lines[start], body: lines.slice(start + 1, end).join("\n") };
  });
  return { preamble: lines.slice(0, starts[0]).join("\n"), sections };
}

function closedForADay(agent: AgentRecord, now: Date): boolean {
  const closedAt = Date.parse(agent.archivedAt ?? "");
  if (Number.isNaN(closedAt)) return false; // unreadable date: keep the section
  return now.getTime() - closedAt > KEEP_CLOSED_MS;
}

function byCreated(a: AgentRecord, b: AgentRecord): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function planFolder(
  text: string,
  agents: AgentRecord[],
  workspaces: WorkspaceRecord[],
  now: Date,
  options: DisplayOptions = DEFAULT_DISPLAY,
  overdueOf?: (short: string, body: string) => number,
): FolderPlan {
  const display = (name: string) => (options.shortenNames ? shortenName(name, options.maxNameLength) : oneLine(name));
  const { preamble, sections } = splitSections(text);
  const here = new Map(agents.map((agent) => [shortAgentId(agent.id), agent]));

  const bodies = new Map<string, string>();
  const headingTitles = new Map<string, string>();
  const unknown: string[] = [];
  for (const section of sections) {
    if (GROUP_LINE.test(section.heading)) {
      // Group lines are regenerated. Anything written under one is kept.
      if (section.body.trim()) unknown.push(section.body);
      continue;
    }
    const match = TAB_HEADING.exec(section.heading);
    if (match && here.has(match[2]) && !bodies.has(match[2])) {
      bodies.set(match[2], section.body);
      headingTitles.set(match[2], match[1]);
    } else {
      unknown.push(`${section.heading}\n${section.body}`);
    }
  }

  const entries = new Map<string | null, { open: TabEntry[]; closed: TabEntry[] }>();
  for (const agent of [...agents].sort(byCreated)) {
    const short = shortAgentId(agent.id);
    const closed = agent.archivedAt !== null;
    const body = bodies.get(short);
    if (closed && body === undefined) continue; // closed before it ever had a section
    const text = body ?? `\n${PLACEHOLDER}\n`;
    if (closed && !hasOpenItems(text) && closedForADay(agent, now)) continue;
    const key = agent.workspaceId;
    if (!entries.has(key)) entries.set(key, { open: [], closed: [] });
    const title = resolveTitle(agent, headingTitles.get(short), display);
    const overdue = overdueOf && body !== undefined ? overdueOf(short, body) : 0;
    const entry: TabEntry = { agent, short, title, number: 0, closed, status: tabStatus(text, overdue), overdue, body: text };
    entries.get(key)![closed ? "closed" : "open"].push(entry);
  }

  const groups: (WorkspaceGroup & { first: string })[] = [];
  for (const [id, { open, closed }] of entries) {
    const workspace = workspaces.find((candidate) => candidate.id === id);
    const tabs = [...open, ...closed];
    tabs.forEach((tab, index) => (tab.number = index + 1));
    groups.push({
      id,
      short: id ? shortWorkspaceId(id) : NO_WORKSPACE_SHORT,
      title: display(id ? workspace?.title ?? id : "Other tabs"),
      archived: Boolean(workspace?.archivedAt),
      tabs,
      first: tabs.map((tab) => tab.agent.createdAt).sort()[0],
    });
  }
  groups.sort((a, b) =>
    a.archived !== b.archived ? (a.archived ? 1 : -1) : a.first < b.first ? -1 : a.first > b.first ? 1 : 0,
  );

  return {
    preamble,
    groups: groups.map(({ first: _first, ...group }) => group),
    unknown,
    dots: options.statusDots,
  };
}

function trimEnd(value: string): string {
  return value.replace(/\n+$/, "");
}

export function renderFolder(plan: FolderPlan): string {
  const parts: string[] = [];
  if (plan.preamble.trim()) parts.push(`${trimEnd(plan.preamble)}\n`);
  const grouped = plan.groups.length > 1;
  for (const group of plan.groups) {
    if (grouped) parts.push(`# ${group.title} · ${group.short}${group.archived ? " · archived" : ""}\n`);
    for (const tab of group.tabs) {
      const dot = plan.dots && !tab.closed && tab.status ? `${DOTS[tab.status]} ` : "";
      const heading = `## ${dot}${tab.number}. ${tab.title} · ${tab.short}${tab.closed ? " · closed" : ""}`;
      parts.push(`${trimEnd(`${heading}\n${tab.body}`)}\n`);
    }
  }
  for (const section of plan.unknown) parts.push(`${trimEnd(section)}\n`);
  return parts.join("\n");
}
