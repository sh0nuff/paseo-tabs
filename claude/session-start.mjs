// SessionStart hook for the paseo-tabs Claude Code plugin.
//
// Inside a Paseo tab whose folder is the top level of a git repo, it gives the
// tab the TABS.md rule, with the tab's short ID and the file's path filled in.
// Anywhere else it prints nothing. It never fails the session.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

try {
  const agentId = process.env.PASEO_AGENT_ID;
  if (agentId) {
    const cwd = process.env.PASEO_AGENT_CWD || hookInput().cwd;
    if (typeof cwd === "string" && cwd && isGitTopLevel(cwd)) {
      const here = dirname(fileURLToPath(import.meta.url));
      const rule = readFileSync(join(here, "rule.md"), "utf8")
        .replaceAll("{{SHORT_ID}}", agentId.slice(0, 7))
        .replaceAll("{{AGENT_ID}}", agentId)
        .replaceAll("{{TABS_PATH}}", join(cwd, "TABS.md"));
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rule } }),
      );
    }
  }
} catch {
  // A broken hook must never block a tab from starting.
}
process.exit(0);
