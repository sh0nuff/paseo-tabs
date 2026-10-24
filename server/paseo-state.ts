// Reads Paseo's own records of agents (tabs) and workspaces from its home folder.
// The plugin's background part has no long-lived Paseo connection, so it reads
// the same files the daemon writes: agents/<folder>/<agent id>.json and
// projects/workspaces.json.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentRecord {
  id: string;
  title: string | null;
  cwd: string;
  workspaceId: string | null;
  provider: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface WorkspaceRecord {
  id: string;
  cwd: string;
  title: string | null;
  archivedAt: string | null;
}

export interface PaseoState {
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
}

export function paseoHome(env: Record<string, string | undefined> = process.env): string {
  if (env.PASEO_HOME) return env.PASEO_HOME;
  return join(env.HOME ?? homedir(), ".paseo");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined; // missing, or caught mid-write
  }
}

function agentFiles(home: string): string[] {
  const root = join(home, "agents");
  const files: string[] = [];
  let folders: string[];
  try {
    folders = readdirSync(root);
  } catch {
    return files;
  }
  for (const folder of folders) {
    let names: string[];
    try {
      names = readdirSync(join(root, folder));
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".json")) files.push(join(root, folder, name));
    }
  }
  return files.sort();
}

function workspacesFile(home: string): string {
  return join(home, "projects", "workspaces.json");
}

export function loadState(home: string): PaseoState {
  const agents: AgentRecord[] = [];
  for (const path of agentFiles(home)) {
    const raw = readJson(path) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object" || raw.internal) continue;
    const id = text(raw.id);
    const cwd = text(raw.cwd);
    if (!id || !cwd) continue;
    agents.push({
      id,
      title: text(raw.title),
      cwd,
      workspaceId: text(raw.workspaceId),
      provider: text(raw.provider) ?? "",
      createdAt: text(raw.createdAt) ?? "",
      archivedAt: text(raw.archivedAt),
    });
  }

  const workspaces: WorkspaceRecord[] = [];
  const list = readJson(workspacesFile(home));
  if (Array.isArray(list)) {
    for (const raw of list as Record<string, unknown>[]) {
      const id = text(raw?.workspaceId);
      const cwd = text(raw?.cwd);
      if (!id || !cwd) continue;
      workspaces.push({ id, cwd, title: text(raw.title), archivedAt: text(raw.archivedAt) });
    }
  }

  return { agents, workspaces };
}

/** Changes whenever any agent file or the workspace list is added, removed or rewritten. */
export function stateFingerprint(home: string): string {
  const parts: string[] = [];
  for (const path of [...agentFiles(home), workspacesFile(home)]) {
    try {
      const info = statSync(path);
      parts.push(`${path}:${info.mtimeMs}:${info.size}`);
    } catch {
      // removed between listing and stat
    }
  }
  return parts.join("\n");
}
