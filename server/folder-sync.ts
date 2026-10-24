// Keeps one folder's TABS.md in step with the tabs open in it.
//
// TABS.md lives only at the top level of a git work tree. It is created when
// the folder has an open Claude tab, and git is told to ignore it whenever it
// is written, so it is never committed. Once it exists it is kept in step
// whatever the tabs are.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PaseoState } from "./paseo-state.ts";
import { DEFAULT_DISPLAY, type DisplayOptions, planFolder, renderFolder } from "./tabs-file.ts";

export interface FileIO {
  read(path: string): string | null;
  write(path: string, text: string): void;
  /** Tells git to ignore TABS.md after a write. Defaults to ensureExcluded. */
  exclude?(dir: string): void;
}

const fileIO: FileIO = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  write(path, text) {
    // writeFileSync truncates and rewrites the same file, so Paseo's file
    // pane keeps watching it. A rename would swap the file out from under it.
    writeFileSync(path, text);
  },
};

const ATTEMPTS = 3;

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function isGitTopLevel(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  return top !== null && realpathSync(top) === realpathSync(dir);
}

/** Adds TABS.md to the repo's own ignore list, the main repo's for a worktree. */
export function ensureExcluded(dir: string): void {
  const relative = git(dir, ["rev-parse", "--git-path", "info/exclude"]);
  if (!relative) return;
  const path = resolve(dir, relative);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.split("\n").includes("TABS.md")) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${current === "" || current.endsWith("\n") ? "" : "\n"}TABS.md\n`);
}

/**
 * "busy" means a tab kept writing to the file through every attempt, so this
 * pass left it alone. The next change to any tab triggers another pass.
 */
export function syncFolder(
  cwd: string,
  state: PaseoState,
  now: Date,
  io: FileIO = fileIO,
  display: DisplayOptions = DEFAULT_DISPLAY,
): "created" | "updated" | "unchanged" | "skipped" | "busy" {
  if (!isGitTopLevel(cwd)) return "skipped";
  const agents = state.agents.filter((agent) => agent.cwd === cwd);
  const path = join(cwd, "TABS.md");

  let current = io.read(path);
  const creating = current === null;
  if (creating && !agents.some((agent) => agent.archivedAt === null && agent.provider === "claude")) {
    return "skipped";
  }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const next = renderFolder(planFolder(current ?? "", agents, state.workspaces, now, display));
    if (next === current) return "unchanged";
    // A tab may have written to the file while this pass was planning.
    // Write only if the file still holds the text the plan was made from.
    const latest = io.read(path);
    if (latest === current) {
      io.write(path, next);
      // Every write, not only the first: a tab may have created the file by
      // hand, and TABS.md must never be committed.
      (io.exclude ?? ensureExcluded)(cwd);
      return creating ? "created" : "updated";
    }
    current = latest;
  }
  return "busy";
}
