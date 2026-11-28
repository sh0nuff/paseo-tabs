// Server half of "open the Pending panel in every new workspace": one state file records the
// workspaces the panel was opened for, so it happens once per workspace across devices.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { claimOpen, type OpenedRecord } from "../shared/auto-open.ts";

export function openedPath(stateDir: string): string {
  return join(stateDir, "panel-opened.json");
}

function read(path: string): OpenedRecord {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as OpenedRecord) : {};
  } catch {
    return {};
  }
}

/** Handler for pending.panelOpenClaim. `enabled` is false outside Pending panel mode. Nothing is recorded then. */
export function panelOpenClaimHandler(path: string, workspaceId: string, enabled: boolean, now: Date): { claimed: boolean } {
  if (!enabled || !workspaceId) return { claimed: false };
  const { claimed, record } = claimOpen(read(path), workspaceId, now);
  if (claimed) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 1));
    renameSync(tmp, path);
  }
  return { claimed };
}

