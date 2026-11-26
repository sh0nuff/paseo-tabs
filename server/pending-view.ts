// TABS.md as a read-only view of the pending store, kept for a week after the
// cut-over so the OpenTodo sync, which still reads TABS.md, keeps working.
// Paseo's records give the sections, their order and numbers (through planFolder,
// as in pending-lines.ts); the store gives the items. Nothing written to the
// file is read back.

import type { PaseoState } from "./paseo-state.ts";
import type { PendingFile, PendingItem } from "./pending-store.ts";
import { compareLetters, DEFAULT_DISPLAY, type DisplayOptions, planFolder, renderFolder, shortAgentId } from "./tabs-file.ts";

export const VIEW_BANNER = "> Read-only view of the Pending panel's store. Edits here are ignored.";
const DAY_MS = 24 * 3600 * 1000;

const oneLine = (value: string) => value.split(/\s+/).filter(Boolean).join(" ");

function visible(items: PendingItem[], now: Date): PendingItem[] {
  const highest = items.map((item) => item.letter).sort(compareLetters).at(-1);
  return items.filter((item) => {
    if (item.status === "open" || item.letter === highest) return true;
    const finished = Date.parse(item.done ?? item.changed);
    return Number.isNaN(finished) || now.getTime() - finished <= DAY_MS;
  });
}

function itemLine(item: PendingItem): string {
  if (item.status !== "open") return `- ${item.letter}) [x] ~~${oneLine(item.what)}~~`;
  const about = item.minutes > 0 ? ` (about ${item.minutes} min)` : "";
  return `- ${item.letter}) [ ] ${oneLine(item.what)}${about}`;
}

function bodyFor(items: PendingItem[], now: Date): string {
  const shown = visible(items, now).sort((a, b) => compareLetters(a.letter, b.letter));
  const open = (kind: string) => shown.filter((item) => item.status === "open" && item.kind === kind);
  const groups: [string, PendingItem[]][] = [
    ["Waiting on you", open("waiting")],
    ["Claude's next steps", open("next")],
    ["Done", shown.filter((item) => item.status !== "open")],
  ];
  const parts = groups.filter(([, list]) => list.length > 0).map(([label, list]) => `**${label}**\n\n${list.map(itemLine).join("\n")}\n`);
  return `\n${parts.join("\n")}`;
}

/**
 * The whole TABS.md for one folder. Pass that folder's files; cwd, when given,
 * limits the tabs to those Paseo has in that folder.
 */
export function renderView(
  files: PendingFile[],
  state: PaseoState,
  now: Date,
  display: DisplayOptions = DEFAULT_DISPLAY,
  cwd?: string,
): string {
  const agents = state.agents.filter((agent) => cwd === undefined || agent.cwd === cwd);
  const itemsOf = (agentId: string, workspaceId: string | null) =>
    files.filter((file) => file.workspaceId === workspaceId).flatMap((file) => file.items).filter((item) => item.agentId === agentId);
  const byShort = new Map<string, PendingItem[]>();
  let text = `${VIEW_BANNER}\n\n`;
  for (const agent of agents) {
    const items = itemsOf(agent.id, agent.workspaceId);
    if (items.length === 0) continue; // an open tab with none gets the usual placeholder
    byShort.set(shortAgentId(agent.id), items);
    text += `## untitled · ${shortAgentId(agent.id)}\n${bodyFor(items, now)}\n`;
  }
  const limit = display.overdueAfterDays * DAY_MS;
  const overdueOf = (short: string) =>
    display.overdueAfterDays > 0
      ? (byShort.get(short) ?? []).filter((item) => item.status === "open" && item.kind === "waiting" && now.getTime() - Date.parse(item.changed) > limit).length
      : 0;
  return renderFolder(planFolder(text, agents, state.workspaces, now, display, overdueOf));
}
