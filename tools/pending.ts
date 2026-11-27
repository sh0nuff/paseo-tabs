// Writes the pending-items store from the command line, so other processes
// share the plugin's one locked writer.
//
//   node tools/pending.ts <add|update|done|drop|reopen|list> --agent <id> [--workspace <id>]
//        [--letter x] [--json '{...}'] [--note '...'] [--cwd <dir>] [--dir <store dir>] [--home <Paseo home>]
//   node tools/pending.ts auto-archive --agent <id> [--scheduled <iso time>]
//                                                       archive the agent's workspace if still nothing is open
//   node tools/pending.ts find <words...>                tabs to hand work to, one JSON line each
//
// Without --workspace, the agent's workspace comes from Paseo's own records (--home, else
// $PASEO_HOME or ~/.paseo), and `add` takes that workspace's folder as its --cwd.
// `add` of a `waiting` item for an agent whose workspace is archived restores the workspace.
// Prints the item (or the list) as JSON. On error prints the message, exit 1.

import { parseArgs } from "node:util";
import { registryPath } from "../server/archived-tabs.ts";
import { autoArchive, findTabs, isArchived } from "../server/auto-archive.ts";
import { loadState, paseoHome } from "../server/paseo-state.ts";
import { addItem, finishItem, listOpen, pendingDir, reopenItem, updateItem } from "../server/pending-store.ts";
import { paseoRunner, runRestore } from "../server/workspace-control.ts";

const USAGE =
  "usage: pending.ts <add|update|done|drop|reopen|list> --agent <id> [--workspace <id>] [--letter x] [--json '{...}'] [--note '...'] [--cwd <dir>] [--home <Paseo home>]\n" +
  "       pending.ts auto-archive --agent <id> [--scheduled <iso time>]\n" +
  "       pending.ts find <words...>";
const COMMANDS = ["add", "update", "done", "drop", "reopen", "list", "auto-archive", "find"];

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      agent: { type: "string" },
      letter: { type: "string" },
      json: { type: "string" },
      note: { type: "string" },
      cwd: { type: "string" },
      dir: { type: "string" },
      home: { type: "string" },
      scheduled: { type: "string" },
    },
  });
  const [command, ...words] = positionals;
  if (!COMMANDS.includes(command)) throw new Error(USAGE);
  const dir = values.dir ?? pendingDir(process.env);
  const home = values.home ?? paseoHome(process.env);
  const now = new Date();
  if (command === "find") {
    for (const row of findTabs(loadState(home), registryPath(process.env), words.join(" "), now)) process.stdout.write(`${JSON.stringify(row)}\n`);
    return;
  }
  const fields = values.json ? JSON.parse(values.json) : {};
  const need = (name: "agent" | "letter"): string => {
    const value = values[name];
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  if (command === "auto-archive") {
    const scheduledAt = values.scheduled ? new Date(values.scheduled) : undefined;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new Error(`--scheduled is not a time: ${values.scheduled}`);
    const line = await autoArchive({ agentId: need("agent"), dir, home, registry: registryPath(process.env), runner: paseoRunner(process.env), now, scheduledAt });
    process.stderr.write(`${line}\n`);
    return;
  }
  let ws = values.workspace;
  let cwd = values.cwd;
  if (!ws) {
    const agentId = need("agent");
    const state = loadState(home);
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent?.workspaceId) throw new Error(`Paseo has no workspace for agent ${agentId}; pass --workspace`);
    ws = agent.workspaceId;
    cwd ??= state.workspaces.find((w) => w.id === ws)?.cwd ?? agent.cwd;
  }
  let out: unknown;
  switch (command) {
    case "add":
      out = addItem(dir, ws, cwd ?? "", need("agent"), fields, now);
      // New work waiting on the user brings an archived workspace back; a `next` item does not.
      if (fields.kind === "waiting" && isArchived(loadState(home), ws)) process.stderr.write(`${runRestore(ws, process.env)}\n`);
      break;
    case "update":
      out = updateItem(dir, ws, need("agent"), need("letter"), fields, now);
      break;
    case "done":
    case "drop":
      out = finishItem(dir, ws, need("agent"), need("letter"), command === "done" ? "done" : "dropped", values.note ?? null, now);
      break;
    case "reopen":
      out = reopenItem(dir, ws, need("agent"), need("letter"), now);
      break;
    case "list":
      out = listOpen(dir, ws, now);
      break;
    default:
      throw new Error(USAGE);
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
