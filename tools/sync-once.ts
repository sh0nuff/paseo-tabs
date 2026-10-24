// One sync pass from the command line, for checks before installing the plugin.
//
//   node tools/sync-once.ts            sync every folder once
//   node tools/sync-once.ts --dry-run  print what would change, and change nothing
//
// It reads Paseo's state from $PASEO_HOME, else ~/.paseo.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FileIO, syncFolder } from "../server/folder-sync.ts";
import { loadState, paseoHome } from "../server/paseo-state.ts";

const dryRun = process.argv.includes("--dry-run");
const state = loadState(paseoHome(process.env));
const now = new Date();

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function printDiff(path: string, before: string, after: string): void {
  const scratch = mkdtempSync(join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), "sync-once-"));
  try {
    writeFileSync(join(scratch, "before"), before);
    writeFileSync(join(scratch, "after"), after);
    const args = ["-u", "--label", `${path} (now)`, "--label", `${path} (after)`, "before", "after"];
    try {
      execFileSync("diff", args, { cwd: scratch, stdio: ["ignore", "inherit", "inherit"] });
    } catch {
      // diff exits 1 when the files differ, which is the expected case here
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const preview: FileIO = {
  read,
  write: (path, text) => printDiff(path, read(path) ?? "", text),
  exclude: () => {},
};

for (const cwd of new Set(state.agents.map((agent) => agent.cwd))) {
  const result = syncFolder(cwd, state, now, dryRun ? preview : undefined);
  console.log(`${cwd}: ${result}`);
}
