// Shared by the pending reminder and stop hooks: finds this agent's open pending items.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function pendingDir() {
  const state = process.env.XDG_STATE_HOME || join(process.env.HOME || homedir(), ".local", "state");
  return join(state, "paseo-tabs", "pending");
}

/** Open items (any kind) for PASEO_AGENT_ID, or [] when store mode is off or the id is unset. */
export function openItemsForAgent() {
  const agentId = process.env.PASEO_AGENT_ID;
  if (!agentId) return [];
  const dir = pendingDir();
  if (!existsSync(join(dir, "cutover"))) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = JSON.parse(readFileSync(join(dir, name), "utf8"));
      for (const item of file.items ?? []) {
        if (item.agentId === agentId && item.status === "open") found.push(item);
      }
    } catch {
      // A bad file is skipped.
    }
  }
  return found;
}

export function stateRoot() {
  return process.env.XDG_STATE_HOME || join(process.env.HOME || homedir(), ".local", "state");
}

export function storeOn() {
  return existsSync(join(pendingDir(), "cutover"));
}

/** Every pending file in the store, parsed; a bad file is skipped. */
export function storeFiles() {
  const dir = pendingDir();
  const files = [];
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (Array.isArray(file.items)) files.push(file);
    } catch {
      // skipped
    }
  }
  return files;
}

function paseoHomeDir() {
  return process.env.PASEO_HOME || join(process.env.HOME || homedir(), ".paseo");
}

/** The agent's workspace id from Paseo's agent records, or null. */
export function agentWorkspace(agentId) {
  const root = join(paseoHomeDir(), "agents");
  let folders = [];
  try {
    folders = readdirSync(root);
  } catch {
    return null;
  }
  for (const folder of folders) {
    const path = join(root, folder, `${agentId}.json`);
    if (!existsSync(path)) continue;
    try {
      const id = JSON.parse(readFileSync(path, "utf8")).workspaceId;
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** True when Paseo's workspace list shows this workspace archived. */
export function workspaceArchived(workspaceId) {
  try {
    const list = JSON.parse(readFileSync(join(paseoHomeDir(), "projects", "workspaces.json"), "utf8"));
    const ws = Array.isArray(list) ? list.find((w) => w && w.workspaceId === workspaceId) : null;
    return !!(ws && ws.archivedAt);
  } catch {
    return false;
  }
}

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PENDING_CLI = join(PLUGIN_ROOT, "tools", "pending.ts");

/** The command that runs tools/workspace-control.ts, or $PASEO_TABS_CONTROL (a JSON array) when set. */
export function controlCommand() {
  try {
    const parsed = JSON.parse(process.env.PASEO_TABS_CONTROL || "null");
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fall through
  }
  return [process.execPath, join(PLUGIN_ROOT, "tools", "workspace-control.ts")];
}
