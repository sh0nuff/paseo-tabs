import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Asks to open the Pending panel in a new workspace. Answers `claimed: true` only for the first
 * ask per workspace across all devices, and only in Pending panel mode; the caller opens the panel then.
 */
export const panelOpenClaim = defineRpc({
  name: "pending.panel-open-claim",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ claimed: z.boolean() }),
});
