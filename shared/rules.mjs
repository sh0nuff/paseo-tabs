// The rule each tab gets, and how it is filled in.
//
// One copy for both deliveries: the Paseo plugin appends it to every agent's system prompt
// (any provider) through `agent.open.before`, and the Claude Code plugin's SessionStart hook
// prints it for Claude tabs that were opened without the Paseo plugin's copy. The text lives
// here, not in Markdown files, because the daemon loads the server half as a bundle and cannot
// read files beside it.
//
// Plain JavaScript with node built-ins only, like install-state.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { autoArchiveFor, modeFor, pendingStoreDir, pluginRoot, tabsStateDir } from "./install-state.mjs";

/** Set in a tab's environment when the Paseo plugin already appended the rule to its system prompt. */
export const RULE_APPENDED_ENV = "PASEO_TABS_RULE_APPENDED";

const CLOSING_ARCHIVE =
  'When nothing is left waiting on the user, first run any wrap-up skill or routine you were given for ending work (it must never move pending items), then end your reply with the line "Nothing further waiting on you." The workspace is then archived by itself about 10 minutes later, unless the user writes to a tab in it, types in its message box or dictates first. It comes back by itself only when a new item waiting on the user is added for this tab; a message runs the tab but leaves the workspace archived.';
const CLOSING_PLAIN = 'When nothing is left waiting on the user, end your reply with the line "Nothing further waiting on you."';
const HANDOFF_ARCHIVED = " Its workspace stays archived unless you add an item waiting on the user.";

/** Fills the rule's placeholders. */
export function fillRule(text, { agentId, cwd, pluginRoot, autoArchive }) {
  return text
    .replaceAll("{{SHORT_ID}}", agentId.slice(0, 7))
    .replaceAll("{{AGENT_ID}}", agentId)
    .replaceAll("{{TABS_PATH}}", join(cwd, "TABS.md"))
    .replaceAll("{{PLUGIN_ROOT}}", pluginRoot)
    .replaceAll("{{CLOSING}}", autoArchive ? CLOSING_ARCHIVE : CLOSING_PLAIN)
    .replaceAll("{{HANDOFF_ARCHIVED}}", autoArchive ? HANDOFF_ARCHIVED : "");
}

/** True when `dir` is the top level of a git repo: the only folders a tab gets the rule in. */
export function isGitTopLevel(dir) {
  try {
    const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return realpathSync(top) === realpathSync(dir);
  } catch {
    return false;
  }
}

/**
 * The filled rule for a tab, with the user's `rule-extra.md` appended, or null outside the top
 * level of a git repo. `saved` holds the saved settings (read from disk when omitted) and
 * `fallbackRoot` the plugin folder to name when neither Paseo nor Claude Code names one.
 */
export function buildRule({ agentId, cwd, env = process.env, saved, fallbackRoot = null }) {
  if (!agentId || typeof cwd !== "string" || !cwd || !isGitTopLevel(cwd)) return null;
  const store = pendingStoreDir(env);
  const pending = modeFor(store, saved, env) === "pending";
  let rule = fillRule(pending ? RULE_PENDING : RULE_TABS_MD, {
    agentId,
    cwd,
    pluginRoot: pluginRoot(env, fallbackRoot) ?? "<the paseo-tabs plugin folder>",
    autoArchive: autoArchiveFor(store, saved, env),
  });
  try {
    const extra = readFileSync(join(tabsStateDir(env), "rule-extra.md"), "utf8").trim();
    if (extra) rule = `${rule.trimEnd()}\n\n${extra}\n`;
  } catch {
    // no additions
  }
  return rule;
}

export const RULE_PENDING = `# Pending items, this tab's list

This tab runs in Paseo. The user sees this workspace's pending items in the Pending panel on the right.

Every ask for the user is said in full in the message itself, in words, with what it is, the exact steps and "(about N min)". Also add it with \`pending_add\`, kind \`waiting\`, with all four fields: what, action, minutes, why. Your own next steps go in with kind \`next\`.

Keep the list current without being asked. Use \`pending_update\` when an item changes. Use \`pending_done\` with status \`done\` or \`dropped\` and a short note when it ends. \`pending_list\` shows your open items. Never refer to an item by its letter alone. Always say its words.

After you do anything, and above all when you end a turn with nothing waiting on the user, reconcile your list. Close with \`pending_done\` every item that is done or stale, drop every item a plan replaced, and add the new ones. An empty waiting list is a valid end state. The moment evidence appears (a command printed its success line, a log shows the step, the user says they did it), close the matching item in that same turn. Never add an item for something you can check yourself.

{{CLOSING}}

To hand work to another tab, find it with \`pending_find\` (live tabs, and ones archived in the last 30 days), then send it a message with \`send_agent_prompt\`.{{HANDOFF_ARCHIVED}} When the work waits on the user, add a \`waiting\` item for that tab with \`node {{PLUGIN_ROOT}}/tools/pending.ts add --agent <its id> --json '{...}'\`.

An item waiting on the user goes into the panel with \`pending_add\` the moment it comes up, even if an older rule or skill says to put it somewhere else. If a new request from the user conflicts with an older rule or skill, say so and ask which wins.

A message starting \`Picked from the panel:\` means the user chose that item. Restate it (what it is, the action, about N min) and start on it together.

A message starting \`Done from the panel:\` means the user has finished that item. Check what you can cheaply (a file, a log, a version), close it with \`pending_done\` and a short note, say in one line what finished, then offer the remaining waiting items as a pick-one question with the recommended one first. If your check shows it is not done, say what you found and keep it open.

When the item is done, mark it with \`pending_done\` and say in one line what finished. Then offer the remaining waiting items as a pick-one question with the recommended one first, so the next one starts the same way.

When you can make a sensible choice that is easy to undo and touches only this tab's work, make it, carry on, and say what you chose and why. Stop and wait only when you can't move without the user's answer, or the action is hard to undo, goes outward under the user's name, or spends money.

**The workspace names the topic, your tab names the task.** Both names are short, stable and lead with the subject: workspace "Billing service", tab "Retry bug". Paseo names a new tab after the start of the user's first message. Once your tab's task is clear, check your current name with Paseo's \`get_agent_status\` and your agent ID, \`{{AGENT_ID}}\`, and set a short task name with \`update_agent\`. If your tab is first in its workspace and the workspace's name reads like the start of a message rather than a name, give the workspace a short topic name with \`rename_workspace\`. Rename only when the task or topic itself changes. Never put a status, such as what waits on the user, in either name, because the pending items already show it. Keep any name the user sets. Skip all of this if you don't have Paseo's tools.

If the \`pending_*\` tools are missing, the Paseo plugin isn't running. Tell the user, and run the same actions through Bash with \`node {{PLUGIN_ROOT}}/tools/pending.ts <add|update|done|drop|reopen|list> --agent {{AGENT_ID}} ...\`, for example \`... list --agent {{AGENT_ID}}\`. Run it with no arguments for usage.
`;

export const RULE_TABS_MD = `# TABS.md, this tab's live checklist

This tab runs in Paseo. The user keeps \`{{TABS_PATH}}\` open beside the chat. It has one section per tab, so they can see what every tab is waiting on and has finished without scrolling back. Keep this tab's section current without being asked.

**Your section** is the one whose heading ends with \`· {{SHORT_ID}}\`, your tab's short ID. The paseo-tabs Paseo plugin writes the headings, \`## <dot> <n>. <tab name> · <short id>\`, where n is the tab's place in its workspace's tab bar. The dot shows where the tab stands: 🔴 an item has waited on the user, unchanged, past their limit (a week unless they changed it), 🟠 something waits on the user, 🔵 only your next steps are open, ✅ nothing is open. Rewording an item restarts its clock, so don't reword one just to clear the red. It follows renames and marks closed tabs \` · closed\`. When the file holds tabs from more than one workspace, it groups them under \`# <workspace name> · <short id>\` lines. If your heading is missing, the Paseo plugin isn't running here. Then add \`## <n>. <tab name> · {{SHORT_ID}}\` at the end of the file yourself. If you have to create the file, also add a \`TABS.md\` line to the repo's \`.git/info/exclude\`, so it is never committed.

**The workspace names the topic, your tab names the task.** Both names are short, stable and lead with the subject: workspace "Billing service", tab "Retry bug". Paseo names a new tab after the start of the user's first message. Once your tab's task is clear, check your current name with Paseo's \`get_agent_status\` and your agent ID, \`{{AGENT_ID}}\`, and set a short task name with \`update_agent\`. If your tab is numbered 1 in its workspace and the workspace's name reads like the start of a message rather than a name, give the workspace a short topic name with \`rename_workspace\`. Rename only when the task or topic itself changes. Never put a status, such as what waits on the user, in either name, because the dot and your items already show it. Keep any name the user sets. Your heading follows. Skip all of this if you don't have Paseo's tools.

**Under your heading**, keep:
- a \`### About this tab\` block with a one-line summary of what this tab is about
- \`Last updated YYYY-MM-DD HH:MM\`
- the bold labels **Waiting on you**, **Claude's next steps** and **Done**, each over a list of items

**Items are lettered**, so the user can say "2b" for tab 2, item b. An open item is \`- a) [ ] text\` and a finished one is \`- a) [x] ~~text~~\`. Letters run on through your whole section, a to z and then aa, and an item keeps its letter when it moves to Done. Finished items leave this file a day after they are ticked, except the one with your highest letter, which stays while your section is here. A new item takes the letter after the highest one in your section, never a letter that is missing. End each item under **Waiting on you** with how long the user's part takes, as \`(about N min)\`, for example \`- c) [ ] Install the app on the TV (about 5 min)\`. Add items as soon as they come up: questions for the user, commands they have to run, your own follow-ups. Update the time on every change.

**Working in the file:**
- Edit only your own section, and re-read the file right before each edit, because other tabs and the plugin write to it too.
- Never start a line in your section with \`## \` or \`# \`. Those lines belong to the plugin.
- Update the file silently. Don't mention it in chat, because the user reads it in the side pane.

**Before you say the tab can be closed.** Closing a tab gives it no turn, so never leave an item for when the tab closes. Before you tell the user the tab can be closed, do that work, then tick or hand over whatever is left.

**Closed tabs.** A closed tab's section moves to the bottom of its workspace and stays while anything in it is open. Once nothing in it is open and the tab has been closed for 24 hours, the plugin moves it to \`TABS-DONE.md\` beside \`TABS.md\`, where it keeps its heading, letters and items. Sections there are history: edit one only if the tab comes back, and then the plugin returns the section to \`TABS.md\`.
- A closed tab can come back. A message sent to it unarchives it with its history, and its section stays valid. Prefer that to a new tab.
- If the user asks you to take over one leftover item from another tab, add it to your section under your next letter, and mark the original \`- b) [x] ~~text~~ (moved to 2f)\`. That is the one edit allowed outside your section.
- If the user asks you to continue a closed tab that can't come back, take over its whole section. Put \`{{SHORT_ID}}\` in its heading in place of the old ID, keep its number, letters and items, and add \`Continues <old id>\` under "About this tab". The section is then yours.
`;
