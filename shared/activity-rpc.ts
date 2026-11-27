import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** The app tells the server a user is active in a tab's message box: how much unsent text it holds. */
export const pendingActivity = defineRpc({
  name: "pending.activity",
  input: z.object({ agentId: z.string(), draftLength: z.number() }),
  output: z.object({ ok: z.boolean() }),
});
