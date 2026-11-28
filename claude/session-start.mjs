// SessionStart hook for the paseo-tabs Claude Code plugin.
//
// Inside a Paseo tab whose folder is the top level of a git repo, it gives the tab the
// Pending panel rule (mode "pending") or the 1.x TABS.md rule (mode "tabs-md"), with the
// tab's IDs, the plugin's folder and the auto-archive wording filled in, plus the user's
// `rule-extra.md` (see lib/rules.mjs). The Paseo plugin (2.1 and later) already appends the
// same rule to every tab's system prompt and sets PASEO_TABS_RULE_APPENDED=1 in its
// environment; then this hook prints nothing, so the rule is never given twice. Anywhere else
// it prints nothing. It never fails the session.

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

async function main() {
  const agentId = process.env.PASEO_AGENT_ID;
  if (!agentId || process.env.PASEO_TABS_RULE_APPENDED === "1") return;
  const cwd = process.env.PASEO_AGENT_CWD || hookInput().cwd;
  const here = dirname(fileURLToPath(import.meta.url));
  // Loaded here, not at the top, so a broken or missing install never stops the hook from exiting 0.
  const { buildRule } = await import(pathToFileURL(join(here, "..", "lib", "rules.mjs")).href);
  const rule = buildRule({ agentId, cwd, env: process.env, fallbackRoot: resolve(here, "..") });
  if (!rule) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rule } }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
    .catch(() => {
      // A broken hook must never block a tab from starting.
    })
    .finally(() => process.exit(0));
}
