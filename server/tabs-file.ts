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
// its id>". Groups follow Paseo's sidebar: pinned workspaces first, then newest
// first, with tabs that have no workspace after them and archived workspaces
// last. This module owns headings, group lines and section order. Each tab owns
// the text under its own heading, which is never changed here, except that a
// finished item leaves a day after it was ticked while that setting is on. A
// section's highest letter always stays, so no letter is ever given out twice.
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
const LETTERED = /^\s*[-*+]\s+([a-z]+)\)(?:\s|$)/;
const REMOVABLE = /^- ([a-z]+)\) \[x\] /;
const STARTS_BLOCK = /^(?:[-*+] |\d+\. |#{1,6}(?:[ \t]|$))/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SECTION_LABELS = /^\*\*(?:Waiting on you|Claude's next steps|Done)\*\*\s*$/m;
const DOTS = { overdue: "🔴", waiting: "🟠", next: "🔵", done: "✅" } as const;
const KEEP_CLOSED_MS = 24 * 3600 * 1000;
/** How long a finished item stays after it was first seen ticked. */
export const TICKED_KEEP_MS = 24 * 3600 * 1000;
const NO_WORKSPACE_SHORT = "0000000";

/** How TABS.md is shown. These are the plugin's settings in Paseo. */
export interface DisplayOptions {
  statusDots: boolean;
  shortenNames: boolean;
  maxNameLength: number;
  /** Days an item may wait on the user unchanged before its tab turns red. 0 means never. */
  overdueAfterDays: number;
  /** Groups newest first by when the workspace was made, or by the newest message to any of its tabs. */
  workspaceOrder: "newest" | "latestMessage";
  /** Finished items leave a day after they were ticked. Only false turns this off. */
  removeFinished: boolean;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  statusDots: true,
  shortenNames: true,
  maxNameLength: 40,
  overdueAfterDays: 7,
  workspaceOrder: "newest",
  removeFinished: true,
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

/** Item letters in the order they are given out: a to z, then aa, ab and so on. */
export function compareLetters(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * For each line, whether it sits in a fenced code block or an HTML comment,
 * the fences and comment marks included. Such lines are examples, not items.
 * A fence closes only on a fence of the same character, at least as long, with
 * nothing after it, so an unusual fence hides more rather than less.
 */
export function hiddenLines(lines: string[]): boolean[] {
  let fence: string | null = null;
  let comment = false;
  return lines.map((line) => {
    if (comment) {
      if (line.includes("-->")) comment = false;
      return true;
    }
    const run = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (run && run[0] === fence[0] && run.length >= fence.length && line.trim() === run) fence = null;
      return true;
    }
    if (run) {
      fence = run;
      return true;
    }
    const start = line.indexOf("<!--");
    if (start === -1) return false;
    comment = !line.includes("-->", start + 4);
    return true;
  });
}

/**
 * The section without the finished items whose letters are in expired. Like
 * isOpenItem, it leans towards keeping: it removes only a whole one-line item,
 * "- <letter>) [x] " at the start of the line with no box left open on it and
 * nothing wrapped or indented under it, and never the section's highest letter.
 * Lines in code blocks and comments are never removed and never counted.
 */
export function withoutFinished(body: string, expired: ReadonlySet<string>): string {
  if (expired.size === 0) return body;
  const lines = body.split("\n");
  const hidden = hiddenLines(lines);
  const shown = lines.filter((_line, index) => !hidden[index]);
  const highest = shown.flatMap((line) => LETTERED.exec(line)?.[1] ?? []).sort(compareLetters).at(-1);
  return lines
    .filter((line, index) => {
      const letter = hidden[index] ? undefined : REMOVABLE.exec(line)?.[1];
      if (!letter || letter === highest || !expired.has(letter) || line.includes("[ ]")) return true;
      // The line straight after an item belongs to it, wrapped text included,
      // unless it starts another list item, a label or a heading.
      const next = lines[index + 1];
      if (next === undefined) return false;
      if (next.trim() !== "") return !(STARTS_BLOCK.test(next) || LABEL.test(next));
      // After a blank line, only indented text still belongs to it.
      const after = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
      return after !== undefined && /^\s/.test(after);
    })
    .join("\n");
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

// When the workspace was made, else when its earliest tab was, or with
// "latestMessage" the newest message to any of its tabs. Any other value, such
// as a setting saved before this one existed, means "newest".
function groupKey(workspace: WorkspaceRecord | undefined, tabs: TabEntry[], order: DisplayOptions["workspaceOrder"]): string {
  const made = workspace?.createdAt || tabs.map((tab) => tab.agent.createdAt).sort()[0];
  if (order !== "latestMessage") return made;
  return tabs.map((tab) => tab.agent.lastUserMessageAt ?? "").sort().at(-1) || made;
}

type SortableGroup = WorkspaceGroup & { pinned: boolean; key: string };

// The order described at the top. Ties go by workspace id, so every pass agrees.
function bySidebar(a: SortableGroup, b: SortableGroup): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.key !== b.key) return a.key > b.key ? -1 : 1;
  const [x, y] = [a.id ?? "", b.id ?? ""];
  return x < y ? -1 : x > y ? 1 : 0;
}

export function planFolder(
  text: string,
  agents: AgentRecord[],
  workspaces: WorkspaceRecord[],
  now: Date,
  options: DisplayOptions = DEFAULT_DISPLAY,
  overdueOf?: (short: string, body: string) => number,
  expiredOf?: (short: string, body: string) => ReadonlySet<string>,
): FolderPlan {
  const display = (name: string) => (options.shortenNames ? shortenName(name, options.maxNameLength) : oneLine(name));
  const tidy = (short: string, body: string) =>
    expiredOf && options.removeFinished !== false ? withoutFinished(body, expiredOf(short, body)) : body;
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
    const written = bodies.get(short);
    if (closed && written === undefined) continue; // closed before it ever had a section
    if (closed && !hasOpenItems(written ?? "") && closedForADay(agent, now)) continue;
    // Finished items are never open, so they go after that check and before the status.
    const body = written === undefined ? undefined : tidy(short, written);
    const text = body ?? `\n${PLACEHOLDER}\n`;
    const key = agent.workspaceId;
    if (!entries.has(key)) entries.set(key, { open: [], closed: [] });
    const title = resolveTitle(agent, headingTitles.get(short), display);
    const overdue = overdueOf && body !== undefined ? overdueOf(short, body) : 0;
    const entry: TabEntry = { agent, short, title, number: 0, closed, status: tabStatus(text, overdue), overdue, body: text };
    entries.get(key)![closed ? "closed" : "open"].push(entry);
  }

  const groups: SortableGroup[] = [];
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
      pinned: Boolean(workspace?.pinnedAt),
      key: groupKey(workspace, tabs, options.workspaceOrder),
    });
  }
  groups.sort(bySidebar);

  return {
    preamble,
    groups: groups.map(({ pinned: _pinned, key: _key, ...group }) => group),
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
