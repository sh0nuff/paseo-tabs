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
import { DONE_FILE, moveFinishedSections } from "./tabs-done.ts";
import { DEFAULT_DISPLAY, type DisplayOptions, closedForADay, planFolder, renderFolder, shortAgentId } from "./tabs-file.ts";

export interface FileIO {
  read(path: string): string | null;
  write(path: string, text: string): void;
  /** Tells git to ignore a file after a write, TABS.md unless a name is given. Defaults to ensureExcluded. */
  exclude?(dir: string, name?: string): void;
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

/** Adds TABS.md, or the named file, to the repo's own ignore list, the main repo's for a worktree. */
export function ensureExcluded(dir: string, name = "TABS.md"): void {
  const relative = git(dir, ["rev-parse", "--git-path", "info/exclude"]);
  if (!relative) return;
  const path = resolve(dir, relative);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.split("\n").includes(name)) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${current === "" || current.endsWith("\n") ? "" : "\n"}${name}\n`);
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
  overdueOf?: (short: string, body: string) => number,
  expiredOf?: (short: string, body: string) => ReadonlySet<string>,
): "created" | "updated" | "unchanged" | "skipped" | "busy" {
  if (!isGitTopLevel(cwd)) return "skipped";
  const agents = state.agents.filter((agent) => agent.cwd === cwd);
  const path = join(cwd, "TABS.md");

  let current = io.read(path);
  const creating = current === null;
  if (creating && !agents.some((agent) => agent.archivedAt === null && agent.provider === "claude")) {
    return "skipped";
  }

  const donePath = join(cwd, DONE_FILE);
  // Paseo's records could not be read, so no tab can be called closed or finished.
  const stateUnknown = state.agents.length === 0;
  const closedShortIds = new Set(
    agents.filter((agent) => agent.archivedAt !== null && closedForADay(agent, now)).map((agent) => shortAgentId(agent.id)),
  );
  const activeShortIds = new Set(agents.filter((agent) => agent.archivedAt === null).map((agent) => shortAgentId(agent.id)));
  const exclude = (name?: string) => (io.exclude ?? ensureExcluded)(cwd, name);

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const done = io.read(donePath) ?? "";
    // A tab brought back gets its section returned first, and nothing moves out on
    // the same pass. The next pass, started by this file changing, does the moving.
    let moves = moveFinishedSections(current ?? "", done, { closedShortIds: new Set(), activeShortIds, stateUnknown });
    const reviving = moves.returned.length > 0;
    if (!reviving) moves = moveFinishedSections(current ?? "", done, { closedShortIds, activeShortIds: new Set(), stateUnknown });
    const next = renderFolder(planFolder(moves.tabs, agents, state.workspaces, now, display, overdueOf, expiredOf));
    const doneChanged = moves.done !== done;
    if (next === current && !doneChanged) return "unchanged";
    // A tab may have written to the file while this pass was planning.
    // Write only if the file still holds the text the plan was made from.
    // TABS-DONE.md gets the same check, so nothing written to it in the meantime is lost.
    const latest = io.read(path);
    if (latest !== current || (io.read(donePath) ?? "") !== done) {
      current = latest;
      continue;
    }
    // Two files cannot be written at once, so the order decides what a crash between
    // them costs. Moving out: TABS-DONE.md first, so a crash leaves the section in
    // both files. Moving back: TABS.md first, for the same reason.
    const writeDone = (): boolean => {
      if (!doneChanged) return true;
      // Read again immediately before writing, as for TABS.md.
      if ((io.read(donePath) ?? "") !== done) return false;
      io.write(donePath, moves.done);
      exclude(DONE_FILE);
      return true;
    };
    const writeTabs = () => {
      if (next === current) return;
      io.write(path, next);
      // Every write, not only the first: a tab may have created the file by
      // hand, and TABS.md must never be committed.
      exclude();
    };
    if (reviving) {
      writeTabs();
      // If TABS-DONE.md changed meanwhile it is left alone. Its copy of the section stays
      // until the next pass, which a change to either file starts.
      writeDone();
    } else {
      if (!writeDone()) {
        current = latest;
        continue;
      }
      writeTabs();
    }
    return creating ? "created" : "updated";
  }
  return "busy";
}
