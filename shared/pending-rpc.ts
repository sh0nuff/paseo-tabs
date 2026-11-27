import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const pendingCard = z.object({
  agentId: z.string(),
  letter: z.string(),
  what: z.string(),
  action: z.string(),
  minutes: z.number(),
  why: z.string(),
  created: z.string(),
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
  input: z.object({ workspaceId: z.string(), agentId: z.string(), letter: z.string(), done: z.boolean().optional() }),
  output: z.object({ message: z.string() }),
});

/** Clears a pick whose message could not be sent to the tab. */
export const pendingUnpick = defineRpc({
  name: "pending.unpick",
  input: z.object({ workspaceId: z.string(), agentId: z.string(), letter: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

/**
 * Whether the Pending panel and tools are on (mode "pending"), and the mode and auto-archive
 * in force, worked out from the saved settings and what is on disk.
 */
export const pendingEnabled = defineRpc({
  name: "pending.enabled",
  input: z.object({}),
  output: z.object({
    enabled: z.boolean(),
    mode: z.enum(["pending", "tabs-md"]).optional(),
    autoArchive: z.boolean().optional(),
  }),
});

/** Open items in every workspace whose what, action or why contains the query. */
export const pendingSearch = defineRpc({
  name: "pending.search",
  input: z.object({ query: z.string() }),
  output: z.object({ hits: z.array(z.object({ workspaceId: z.string(), workspaceName: z.string(), card: pendingCard })) }),
});
