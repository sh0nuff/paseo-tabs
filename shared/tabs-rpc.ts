import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const tabRow = z.object({
  agentId: z.string(),
  short: z.string(),
  number: z.number(),
  title: z.string(),
  closed: z.boolean(),
  waiting: z.number(),
  next: z.number(),
  overdue: z.number(),
  status: z.enum(["overdue", "waiting", "next", "done"]).nullable(),
  about: z.string(),
});

export type TabRow = z.infer<typeof tabRow>;

/** This workspace's tabs in tab-bar order, with open items counted from TABS.md. */
export const tabsList = defineRpc({
  name: "tabs.list",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ tabs: z.array(tabRow) }),
});

/** What a workspace's row in Paseo's sidebar says: its most urgent open tab. */
export const tabLine = z.object({
  status: z.enum(["overdue", "waiting", "next", "done"]).nullable(),
  title: z.string(),
  /** The first item waiting on the user, cleaned for one line, or "". */
  waiting: z.string(),
  /** How many other tabs in the workspace are open. */
  more: z.number(),
});

export type TabLine = z.infer<typeof tabLine>;

/** One line per workspace that has an open tab in a TABS.md, keyed by workspace id. */
export const tabsLines = defineRpc({
  name: "tabs.lines",
  input: z.object({}),
  output: z.object({ lines: z.record(z.string(), tabLine) }),
});

export function lineText(line: TabLine): string {
  const more = line.more > 0 ? ` +${line.more}` : "";
  const waiting = line.waiting ? ` · ${line.waiting}` : "";
  return `${line.title}${more}${waiting}`;
}
