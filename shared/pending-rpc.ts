import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const pendingCard = z.object({
  agentId: z.string(),
  letter: z.string(),
  what: z.string(),
  action: z.string(),
  minutes: z.number(),
  why: z.string(),
  picked: z.boolean(),
  status: z.enum(["open", "done", "dropped"]),
});

export type PendingCard = z.infer<typeof pendingCard>;

/** Open items waiting on the user in one workspace, oldest first. */
export const pendingList = defineRpc({
  name: "pending.list",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ items: z.array(pendingCard) }),
});

/** Marks one item picked and returns the message to send to its tab. */
export const pendingPick = defineRpc({
  name: "pending.pick",
  input: z.object({ workspaceId: z.string(), agentId: z.string(), letter: z.string() }),
  output: z.object({ message: z.string() }),
});

/** Open items in every workspace whose what, action or why contains the query. */
export const pendingSearch = defineRpc({
  name: "pending.search",
  input: z.object({ query: z.string() }),
  output: z.object({ hits: z.array(z.object({ workspaceId: z.string(), workspaceName: z.string(), card: pendingCard })) }),
});
