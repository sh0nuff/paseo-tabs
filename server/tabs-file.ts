// The TABS.md format: one section per tab, grouped by Paseo workspace.
//
// A tab's heading is "## <n>. <title> · <first 7 characters of its agent id>",
// with " · closed" once the tab is archived. n is the tab's place in its
// workspace's tab bar, in the order the tabs were opened, and closed tabs carry
// on after the open ones. When a file holds tabs from more than one workspace,
// each workspace's sections sit under "# <workspace title> · <7 characters of
// its id>". This module owns headings, group lines and section order. Each
// tab owns the text under its own heading, which is never changed here.
//
// A closed tab's section stays while anything in it is open. It goes once
// nothing is open and the tab has been closed for 24 hours.

import type { AgentRecord, WorkspaceRecord } from "./paseo-state.ts";

export const PLACEHOLDER = "No items yet. This tab hasn't written to this file.";

const TAB_HEADING = /^## (?:\d+\. )?(.*?) · ([0-9a-f]{7})( · closed)?[ \t]*$/;
const GROUP_LINE = /^# (.*?) · ([0-9a-f]{7})( · archived)?[ \t]*$/;
const DONE_ITEM = /^- (?:[a-z]+\) )?\[x\] /;
const LABEL = /^\*\*.+\*\*\s*$/;
const KEEP_CLOSED_MS = 24 * 3600 * 1000;
const NO_WORKSPACE_SHORT = "0000000";

export interface TabEntry {
  agent: AgentRecord;
  short: string;
  /** Paseo's name for the tab, else the name in its heading, else "untitled". */
  title: string;
  number: number;
  closed: boolean;
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

function resolveTitle(agent: AgentRecord, headingTitle: string | undefined): string {
  return oneLine(agent.title ?? "") || oneLine(headingTitle ?? "") || "untitled";
}

function isOpenItem(line: string): boolean {
  return line.startsWith("- ") && !DONE_ITEM.test(line) && !line.startsWith("- Nothing");
}

/** True if any list line in a section is not ticked. Unusual lines count as open. */
export function hasOpenItems(body: string): boolean {
  return body.split("\n").some(isOpenItem);
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
): FolderPlan {
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
    const title = resolveTitle(agent, headingTitles.get(short));
    const entry: TabEntry = { agent, short, title, number: 0, closed, body: text };
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
      title: oneLine(id ? workspace?.title ?? id : "Other tabs"),
      archived: Boolean(workspace?.archivedAt),
      tabs,
      first: tabs.map((tab) => tab.agent.createdAt).sort()[0],
    });
  }
  groups.sort((a, b) =>
    a.archived !== b.archived ? (a.archived ? 1 : -1) : a.first < b.first ? -1 : a.first > b.first ? 1 : 0,
  );

  return { preamble, groups: groups.map(({ first: _first, ...group }) => group), unknown };
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
      const heading = `## ${tab.number}. ${tab.title} · ${tab.short}${tab.closed ? " · closed" : ""}`;
      parts.push(`${trimEnd(`${heading}\n${tab.body}`)}\n`);
    }
  }
  for (const section of plan.unknown) parts.push(`${trimEnd(section)}\n`);
  return parts.join("\n");
}
