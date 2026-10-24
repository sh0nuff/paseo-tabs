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
});

export type TabRow = z.infer<typeof tabRow>;

/** This workspace's tabs in tab-bar order, with open items counted from TABS.md. */
export const tabsList = defineRpc({
  name: "tabs.list",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ tabs: z.array(tabRow) }),
});
