// Stop hook, two jobs, the first one winning:
//
// 1. When a tab did real work this turn (3 or more tool uses), touched no pending tool,
//    and still has open items, block once so it reconciles its list.
// 2. When every item in the tab's workspace is closed and one was closed since the last
//    time this ran, the workspace is archived: first the tab is asked once to end with
//    "Nothing further waiting on you.", then an archive is scheduled 90 s out, so the
//    final message reaches the user first. The scheduled run checks everything again.
//    Skipped when the workspace is already archived (a message ran the tab there).
//
// Never fails: any error means no output.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PENDING_CLI, agentWorkspace, openItemsForAgent, stateRoot, storeFiles, storeOn, workspaceArchived } from "./pending-lib.mjs";

const LINE = "Nothing further waiting on you";
const DELAY_S = 90;

function isPendingUse(block) {
  if (typeof block.name === "string" && block.name.includes("pending_")) return true;
  const cmd = block.input && block.input.command;
  return typeof cmd === "string" && cmd.includes("tools/pending.ts");
}

function onlyToolResults(content) {
  return Array.isArray(content) && content.length > 0 && content.every((b) => b && b.type === "tool_result");
}

function readTranscript(path) {
  if (typeof path !== "string") return [];
  try {
    return readFileSync(path, "utf8")
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
  } catch {
    return [];
  }
}

/** The text of the turn's last assistant message: from the hook input, else the transcript. */
function lastAssistantText(input, turn) {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  for (let i = turn.length - 1; i >= 0; i--) {
    const e = turn[i];
    if (e.type !== "assistant") continue;
    const content = e.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const text = content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
    if (text) return text;
  }
  return "";
}

function markerPath(agentId) {
  return join(stateRoot(), "paseo-tabs", "auto-archive", encodeURIComponent(agentId));
}

function lastHandled(agentId) {
  try {
    return readFileSync(markerPath(agentId), "utf8").trim();
  } catch {
    return "";
  }
}

function setHandled(agentId, stamp) {
  mkdirSync(join(stateRoot(), "paseo-tabs", "auto-archive"), { recursive: true });
  writeFileSync(markerPath(agentId), `${stamp}\n`);
}

function scheduleArchive(agentId) {
  const args = [PENDING_CLI, "auto-archive", "--agent", agentId];
  const setenv = ["PATH", "HOME", "XDG_STATE_HOME", "PASEO_HOME", "PASEO_CLI_ROOT"]
    .filter((k) => process.env[k])
    .map((k) => `--setenv=${k}=${process.env[k]}`);
  const unit = `paseo-tabs-archive-${agentId.slice(0, 8)}`;
  const r = spawnSync(
    "systemd-run",
    ["--user", "--quiet", "--collect", `--on-active=${DELAY_S}`, `--unit=${unit}`, ...setenv, process.execPath, ...args],
    { stdio: "ignore", timeout: 10_000 },
  );
  if (r.status === 0) return;
  spawn("sh", ["-c", `sleep ${DELAY_S}; exec "$0" "$@"`, process.execPath, ...args], { detached: true, stdio: "ignore" }).unref();
}

/** Returns the block reason, or null after scheduling or when nothing applies. */
function autoArchive(input, turn) {
  const agentId = process.env.PASEO_AGENT_ID;
  if (!agentId || !storeOn()) return null;
  const files = storeFiles().filter((f) => f.items.some((i) => i && i.agentId === agentId));
  if (files.length === 0) return null; // this tab never had an item
  const items = files.flatMap((f) => f.items);
  if (items.some((i) => i && i.status === "open")) return null; // something still waits, in this tab or a sibling
  const latest = items
    .map((i) => (i && i.done ? Date.parse(i.done) : NaN))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  if (!latest) return null;
  const stamp = new Date(latest).toISOString();
  if (lastHandled(agentId) === stamp) return null; // nothing closed since the last archive
  const ws = agentWorkspace(agentId);
  if (ws && workspaceArchived(ws)) return null; // a message ran this tab while archived: it stays archived
  const said = lastAssistantText(input, turn).toLowerCase().includes(LINE.toLowerCase());
  if (input.stop_hook_active !== true && !said) {
    return "All pending items are closed. End your reply with the line: Nothing further waiting on you. This workspace is then archived automatically.";
  }
  setHandled(agentId, stamp);
  scheduleArchive(agentId);
  return null;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const entries = readTranscript(input.transcript_path);
  let start = 0;
  entries.forEach((e, i) => {
    if (e.type === "user" && !onlyToolResults(e.message?.content)) start = i + 1;
  });
  const turn = entries.slice(start);
  let reason = null;
  if (input.stop_hook_active !== true) {
    const uses = [];
    for (const e of turn) {
      if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
      for (const b of e.message.content) if (b && b.type === "tool_use") uses.push(b);
    }
    if (uses.length >= 3 && !uses.some(isPendingUse) && openItemsForAgent().length > 0) {
      reason =
        "Before you end this turn, reconcile your pending list: run pending_list, close with pending_done what is done or stale, add what is new. Then finish.";
    }
  }
  if (reason === null) reason = autoArchive(input, turn);
  if (reason !== null) process.stdout.write(JSON.stringify({ decision: "block", reason }));
} catch {
  // No output on any error.
}
process.exit(0);
