// Writes the pending-items store from the command line, so other processes
// share the plugin's one locked writer.
//
//   node tools/pending.ts <add|update|done|drop|reopen|list> --workspace <id> --agent <id>
//        [--letter x] [--json '{...}'] [--note '...'] [--cwd <dir>] [--dir <store dir>]
//
// Prints the item (or the list) as JSON. On error prints the message, exit 1.

import { parseArgs } from "node:util";
import { addItem, finishItem, listOpen, pendingDir, reopenItem, updateItem } from "../server/pending-store.ts";

function main(): void {
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
    },
  });
  const [command] = positionals;
  const dir = values.dir ?? pendingDir(process.env);
  const ws = values.workspace;
  if (!ws) throw new Error("--workspace is required");
  const now = new Date();
  const fields = values.json ? JSON.parse(values.json) : {};
  const need = (name: "agent" | "letter"): string => {
    const value = values[name];
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  let out: unknown;
  switch (command) {
    case "add":
      out = addItem(dir, ws, values.cwd ?? "", need("agent"), fields, now);
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
      throw new Error("usage: pending.ts <add|update|done|drop|reopen|list> --workspace <id> --agent <id> [--letter x] [--json '{...}'] [--note '...']");
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
