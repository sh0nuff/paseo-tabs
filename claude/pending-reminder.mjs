// UserPromptSubmit hook: lists this tab's open pending items and asks it to reconcile
// the list before replying. Prints nothing when the tab has none. Never fails.

import { openItemsForAgent } from "./pending-lib.mjs";

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
