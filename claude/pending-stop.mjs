// Stop hook: when a tab did real work this turn (3 or more tool uses), touched no
// pending tool, and still has open items, block once so it reconciles its list.
// Never fails: any error means no output.

import { readFileSync } from "node:fs";
import { openItemsForAgent } from "./pending-lib.mjs";

function isPendingUse(block) {
  if (typeof block.name === "string" && block.name.includes("pending_")) return true;
  const cmd = block.input && block.input.command;
  return typeof cmd === "string" && cmd.includes("tools/pending.ts");
}

function onlyToolResults(content) {
  return Array.isArray(content) && content.length > 0 && content.every((b) => b && b.type === "tool_result");
}

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active !== true && typeof input.transcript_path === "string") {
    const entries = readFileSync(input.transcript_path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    let start = 0;
    entries.forEach((e, i) => {
      if (e.type === "user" && !onlyToolResults(e.message?.content)) start = i + 1;
    });
    const uses = [];
    for (const e of entries.slice(start)) {
      if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
      for (const b of e.message.content) if (b && b.type === "tool_use") uses.push(b);
    }
    if (uses.length >= 3 && !uses.some(isPendingUse) && openItemsForAgent().length > 0) {
      process.stdout.write(
        JSON.stringify({
          decision: "block",
          reason:
            "Before you end this turn, reconcile your pending list: run pending_list, close with pending_done what is done or stale, add what is new. Then finish.",
        }),
      );
    }
  }
} catch {
  // No output on any error.
}
process.exit(0);
