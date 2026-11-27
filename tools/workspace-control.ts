// Restores or archives one Paseo workspace.
//
//   node tools/workspace-control.ts restore <workspaceId>   restores it when Paseo says it can, and
//                                                           drops its entry from archived-tabs.json
//   node tools/workspace-control.ts archive <workspaceId>   runs `paseo workspace archive <id>`
//
// Prints one line. On error prints the message, exit 1.

import { readRegistry, registryPath, removeArchived } from "../server/archived-tabs.ts";
import { archiveWorkspace, paseoRunner, restoreWorkspace } from "../server/workspace-control.ts";

const USAGE = "usage: workspace-control.ts <restore|archive> <workspaceId>";

async function main(): Promise<void> {
  const [command, id] = process.argv.slice(2);
  if (!id || (command !== "restore" && command !== "archive")) throw new Error(USAGE);
  const runner = paseoRunner(process.env);
  if (command === "archive") {
    await archiveWorkspace(id, runner);
    process.stdout.write(`archived ${id}\n`);
    return;
  }
  const result = await restoreWorkspace(id, runner);
  const registry = registryPath(process.env);
  const now = new Date();
  const dropped = readRegistry(registry, now).some((e) => e.workspaceId === id) ? removeArchived(registry, [id], now) : 0;
  process.stdout.write(`${id}: ${result}${dropped ? ", registry entry removed" : ""}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
