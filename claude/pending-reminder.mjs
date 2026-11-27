// UserPromptSubmit hook: lists this tab's open pending items and asks it to reconcile
// the list before replying. Prints nothing when the tab has none. Never fails.
// When this tab's workspace was archived, it restores the workspace first (waiting
// at most 20 s), so a tab that gets a message comes back with its workspace.

import { spawnSync } from "node:child_process";
import { agentWorkspace, controlCommand, openItemsForAgent, storeOn, workspaceArchived } from "./pending-lib.mjs";

try {
  const agentId = process.env.PASEO_AGENT_ID;
  if (agentId && storeOn()) {
    const ws = agentWorkspace(agentId);
    if (ws && workspaceArchived(ws)) {
      const [cmd, ...args] = controlCommand();
      spawnSync(cmd, [...args, "restore", ws], { stdio: "ignore", timeout: 20_000 });
    }
  }
} catch {
  // A failed restore must never block a prompt.
}

try {
  const items = openItemsForAgent();
  if (items.length > 0) {
    const lines = items.map((i) => `${i.letter}) ${i.what} (about ${i.minutes} min) [${i.kind}]`);
    const text =
      `Your open pending items:\n${lines.join("\n")}\n` +
      "Reconcile before you reply: close with pending_done anything done or stale, drop what the plan replaced, add what is new. Never add an item you can check yourself.";
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } }),
    );
  }
} catch {
  // A broken hook must never block a prompt.
}
process.exit(0);
