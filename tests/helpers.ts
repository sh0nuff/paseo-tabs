import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const NOW = new Date("2026-10-24T12:00:00.000Z");
export const NEW = "No items yet. This tab hasn't written to this file.";

export function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "paseo-tabs-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function gitInit(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

/** A Paseo home folder inside root, with agents/ and projects/. */
export function makeHome(root: string): string {
  const home = join(root, "paseo-home");
  mkdirSync(join(home, "agents", "some-folder"), { recursive: true });
  mkdirSync(join(home, "projects"), { recursive: true });
  return home;
}

export interface AgentJson {
  id: string;
  cwd: string;
  title?: string | null;
  workspaceId?: string | null;
  provider?: string;
  createdAt?: string;
  archivedAt?: string | null;
}

/** Writes an agent file. mtime, when given, makes the change visible to the fingerprint. */
export function writeAgent(home: string, agent: AgentJson, mtime?: Date): void {
  const path = join(home, "agents", "some-folder", `${agent.id}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      provider: "claude",
      title: `${agent.id[0].toUpperCase()} title`,
      workspaceId: "wks_1111111aaaaaaa",
      createdAt: "2026-10-24T09:00:00.000Z",
      archivedAt: null,
      ...agent,
    }),
  );
  if (mtime) utimesSync(path, mtime, mtime);
}

export function writeWorkspaces(home: string, list: { workspaceId: string; cwd: string; title: string; archivedAt?: string | null }[]): void {
  writeFileSync(join(home, "projects", "workspaces.json"), JSON.stringify(list));
}

export function excludeLines(repo: string): string[] {
  const path = join(repo, ".git", "info", "exclude");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line === "TABS.md") : [];
}
