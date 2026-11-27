// Shared by the pending reminder and stop hooks: finds this agent's open pending items.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function pendingDir() {
  const state = process.env.XDG_STATE_HOME || join(process.env.HOME || homedir(), ".local", "state");
  return join(state, "paseo-tabs", "pending");
}

/** Open items (any kind) for PASEO_AGENT_ID, or [] when store mode is off or the id is unset. */
export function openItemsForAgent() {
  const agentId = process.env.PASEO_AGENT_ID;
  if (!agentId) return [];
  const dir = pendingDir();
  if (!existsSync(join(dir, "cutover"))) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = JSON.parse(readFileSync(join(dir, name), "utf8"));
      for (const item of file.items ?? []) {
        if (item.agentId === agentId && item.status === "open") found.push(item);
      }
    } catch {
      // A bad file is skipped.
    }
  }
  return found;
}
