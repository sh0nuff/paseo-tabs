// SessionStart hook for the paseo-tabs Claude Code plugin.
//
// Inside a Paseo tab whose folder is the top level of a git repo, it gives the tab the
// Pending panel rule (mode "pending") or the 1.x TABS.md rule (mode "tabs-md"), with the
// tab's IDs, the plugin's folder and the auto-archive wording filled in. A file
// `rule-extra.md` in the plugin's state folder (~/.local/state/paseo-tabs/) is appended
// when present, for the user's own additions. Anywhere else it prints nothing. It never
// fails the session.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function hookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function isGitTopLevel(dir) {
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

const CLOSING_ARCHIVE =
  'When nothing is left waiting on the user, first run any wrap-up skill or routine you were given for ending work (it must never move pending items), then end your reply with the line "Nothing further waiting on you." The workspace is then archived by itself about 10 minutes later, unless the user writes to a tab in it, types in its message box or dictates first. It comes back by itself only when a new item waiting on the user is added for this tab; a message runs the tab but leaves the workspace archived.';
const CLOSING_PLAIN = 'When nothing is left waiting on the user, end your reply with the line "Nothing further waiting on you."';
const HANDOFF_ARCHIVED = " Its workspace stays archived unless you add an item waiting on the user.";

/** Fills the rule's placeholders. Exported for tests. */
export function fillRule(text, { agentId, cwd, pluginRoot, autoArchive }) {
  return text
    .replaceAll("{{SHORT_ID}}", agentId.slice(0, 7))
    .replaceAll("{{AGENT_ID}}", agentId)
    .replaceAll("{{TABS_PATH}}", join(cwd, "TABS.md"))
    .replaceAll("{{PLUGIN_ROOT}}", pluginRoot)
    .replaceAll("{{CLOSING}}", autoArchive ? CLOSING_ARCHIVE : CLOSING_PLAIN)
    .replaceAll("{{HANDOFF_ARCHIVED}}", autoArchive ? HANDOFF_ARCHIVED : "");
}

async function main() {
  const agentId = process.env.PASEO_AGENT_ID;
  if (!agentId) return;
  const cwd = process.env.PASEO_AGENT_CWD || hookInput().cwd;
  if (typeof cwd !== "string" || !cwd || !isGitTopLevel(cwd)) return;
  const here = dirname(fileURLToPath(import.meta.url));
  // Loaded here, not at the top, so a broken or missing install never stops the hook from exiting 0.
  const lib = await import(pathToFileURL(join(here, "..", "shared", "install-state.mjs")).href);
  const store = lib.pendingStoreDir(process.env);
  const pending = lib.modeFor(store, undefined, process.env) === "pending";
  let rule = fillRule(readFileSync(join(here, pending ? "rule-pending.md" : "rule.md"), "utf8"), {
    agentId,
    cwd,
    pluginRoot: lib.pluginRoot(process.env, resolve(here, "..")),
    autoArchive: lib.autoArchiveFor(store, undefined, process.env),
  });
  try {
    const extra = readFileSync(join(lib.tabsStateDir(process.env), "rule-extra.md"), "utf8").trim();
    if (extra) rule = `${rule.trimEnd()}\n\n${extra}\n`;
  } catch {
    // no additions
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rule } }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
    .catch(() => {
      // A broken hook must never block a tab from starting.
    })
    .finally(() => process.exit(0));
}
