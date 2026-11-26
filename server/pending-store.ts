// Per-workspace items waiting on the user, kept as one JSON file each under
// ~/.local/state/paseo-tabs/pending. Every writer (agent tools, panel, the CLI,
// the TABS.md import) goes through this module: it takes a lock file, reads,
// changes and writes through a temp file and a rename, so no write is lost.

import { randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nextLetter } from "./item-clock.ts";
import { compareLetters } from "./tabs-file.ts";

export type PendingKind = "waiting" | "next";
export type PendingStatus = "open" | "done" | "dropped";

export type PendingItem = {
  letter: string;
  agentId: string;
  kind: PendingKind;
  what: string;
  action: string;
  minutes: number;
  why: string;
  status: PendingStatus;
  picked: boolean;
  created: string;
  changed: string;
  done: string | null;
  note: string | null;
  opentodo: string | null;
};

export type PendingFile = {
  workspaceId: string;
  cwd: string;
  items: PendingItem[];
  /** Agent id to the highest letter ever used, so a letter is never reused. */
  highest: Record<string, string>;
};

export type ItemFields = { kind: PendingKind; what: string; action: string; minutes: number; why: string };

export class PendingCorrupt extends Error {
  constructor(path: string, cause: unknown) {
    super(`Pending file is not valid JSON, left untouched: ${path} (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = "PendingCorrupt";
  }
}

/** An ISO 8601 time with the local UTC offset, such as 2026-11-26T14:02:00-05:00. */
export function localIso(date: Date): string {
  const p = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}` +
    `${sign}${p(Math.trunc(off / 60))}:${p(off % 60)}`
  );
}

const DAY_MS = 24 * 3600 * 1000;
const LOCK_RETRY_MS = 50;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;

export function pendingDir(env: Record<string, string | undefined>): string {
  const state = env.XDG_STATE_HOME || join(env.HOME ?? homedir(), ".local", "state");
  return join(state, "paseo-tabs", "pending");
}

function filePath(dir: string, workspaceId: string): string {
  return join(dir, `${encodeURIComponent(workspaceId)}.json`);
}

function emptyFile(workspaceId: string, cwd = ""): PendingFile {
  return { workspaceId, cwd, items: [], highest: {} };
}

function readFileAt(path: string, workspaceId: string): PendingFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile(workspaceId);
    throw error;
  }
  let parsed: Partial<PendingFile>;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PendingCorrupt(path, error);
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.items)) {
    throw new PendingCorrupt(path, new Error("missing items"));
  }
  return {
    workspaceId: parsed.workspaceId ?? workspaceId,
    cwd: parsed.cwd ?? "",
    items: parsed.items,
    highest: parsed.highest ?? {},
  };
}

export function readPending(dir: string, workspaceId: string): PendingFile {
  return readFileAt(filePath(dir, workspaceId), workspaceId);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Removes a stale lock by renaming it away first, so only one waiter wins and a fresh lock is never unlinked. */
function stealStale(lock: string): void {
  const aside = `${lock}.stale.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    renameSync(lock, aside);
  } catch {
    return; // someone else stole or released it
  }
  try {
    if (Date.now() - statSync(aside).mtimeMs > LOCK_STALE_MS) {
      unlinkSync(aside);
      return;
    }
    // Took a fresh lock by mistake: put it back if the slot is still free.
    try {
      linkSync(aside, lock);
    } catch {
      // another lock took the slot; the holder's release finds a foreign token and leaves it
    }
    unlinkSync(aside);
  } catch {
    // gone already
  }
}

function withLock<T>(path: string, work: () => T): T {
  mkdirSync(join(path, ".."), { recursive: true });
  const lock = `${path}.lock`;
  const token = `${process.pid}.${randomBytes(8).toString("hex")}`;
  const started = Date.now();
  for (;;) {
    try {
      writeFileSync(lock, token, { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          stealStale(lock);
          continue;
        }
      } catch {
        continue; // the holder just released it
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`Timed out waiting for lock ${lock}`);
      sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return work();
  } finally {
    try {
      // Release only our own lock: after a steal, the file may be someone else's.
      if (readFileSync(lock, "utf8") === token) unlinkSync(lock);
    } catch {
      // already gone
    }
  }
}

function write(path: string, file: PendingFile): void {
  const scratch = `${path}.${process.pid}.tmp`;
  writeFileSync(scratch, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(scratch, path);
}

function mutate<T>(dir: string, workspaceId: string, change: (file: PendingFile) => T): T {
  const path = filePath(dir, workspaceId);
  return withLock(path, () => {
    const file = readFileAt(path, workspaceId);
    const result = change(file);
    write(path, file);
    return result;
  });
}

function checkFields(fields: Partial<ItemFields>, all: boolean): void {
  const text = (name: "what" | "action" | "why") => {
    const value = fields[name];
    if (value === undefined && !all) return;
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must not be empty`);
  };
  text("what");
  text("action");
  text("why");
  if (fields.minutes !== undefined || all) {
    if (!Number.isInteger(fields.minutes) || (fields.minutes as number) <= 0) throw new Error("minutes must be an integer above 0");
  }
  if (fields.kind !== undefined || all) {
    if (fields.kind !== "waiting" && fields.kind !== "next") throw new Error('kind must be "waiting" or "next"');
  }
}

function find(file: PendingFile, agentId: string, letter: string): PendingItem {
  const item = file.items.find((i) => i.agentId === agentId && i.letter === letter);
  if (!item) throw new Error(`No item ${letter} for agent ${agentId}`);
  return item;
}

export function addItem(dir: string, ws: string, cwd: string, agentId: string, fields: ItemFields, now: Date): PendingItem {
  checkFields(fields, true);
  return mutate(dir, ws, (file) => {
    const known = [file.highest[agentId], ...file.items.filter((i) => i.agentId === agentId).map((i) => i.letter)]
      .filter((l): l is string => !!l)
      .sort(compareLetters)
      .at(-1);
    const letter = nextLetter(known);
    const time = localIso(now);
    const item: PendingItem = {
      letter, agentId, kind: fields.kind, what: fields.what, action: fields.action, minutes: fields.minutes, why: fields.why,
      status: "open", picked: false, created: time, changed: time, done: null, note: null, opentodo: null,
    };
    file.items.push(item);
    file.highest[agentId] = letter;
    if (cwd) file.cwd = cwd;
    return item;
  });
}

export function updateItem(
  dir: string, ws: string, agentId: string, letter: string,
  patch: Partial<Pick<ItemFields, "what" | "action" | "minutes" | "why" | "kind">>, now: Date,
): PendingItem {
  checkFields(patch, false);
  return mutate(dir, ws, (file) => {
    const item = find(file, agentId, letter);
    for (const key of ["what", "action", "minutes", "why", "kind"] as const) {
      if (patch[key] !== undefined) (item as Record<string, unknown>)[key] = patch[key];
    }
    item.changed = localIso(now);
    return item;
  });
}

export function finishItem(dir: string, ws: string, agentId: string, letter: string, status: "done" | "dropped", note: string | null, now: Date): PendingItem {
  return mutate(dir, ws, (file) => {
    const item = find(file, agentId, letter);
    item.status = status;
    item.note = note;
    item.picked = false;
    item.done = localIso(now);
    item.changed = item.done;
    return item;
  });
}

export function reopenItem(dir: string, ws: string, agentId: string, letter: string, now: Date): PendingItem {
  return mutate(dir, ws, (file) => {
    const item = find(file, agentId, letter);
    item.status = "open";
    item.done = null;
    item.changed = localIso(now);
    return item;
  });
}

/**
 * Marks one item picked and clears the others. An item already picked is refused, so two
 * devices picking at once send only once. A pick is not a change to the item, so `changed`
 * (which drives the overdue dot) is left alone.
 */
export function setPicked(dir: string, ws: string, agentId: string, letter: string, _now: Date): PendingItem {
  return mutate(dir, ws, (file) => {
    const item = find(file, agentId, letter);
    if (item.status !== "open") throw new Error(`Item ${letter} is ${item.status}; only an open item can be picked`);
    if (item.picked) throw new Error(`Item ${letter} is already picked`);
    for (const other of file.items) other.picked = false;
    item.picked = true;
    return item;
  });
}

/** Clears a pick whose message could not be sent, so the item can be picked again. */
export function clearPicked(dir: string, ws: string, agentId: string, letter: string): PendingItem {
  return mutate(dir, ws, (file) => {
    const item = find(file, agentId, letter);
    item.picked = false;
    return item;
  });
}

/** Open items, plus those done within the last 24 hours. */
export function listOpen(dir: string, ws: string, now: Date): PendingItem[] {
  return readPending(dir, ws).items.filter(
    (i) => i.status === "open" || (i.status === "done" && i.done !== null && now.getTime() - Date.parse(i.done) <= DAY_MS),
  );
}

export function allFiles(dir: string): PendingFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readFileAt(join(dir, name), decodeURIComponent(name.slice(0, -5))));
}

/**
 * Merges files into the stored ones by (agentId, letter), skipping items already
 * present and raising each agent's highest letter. No field validation: imports
 * from TABS.md may carry minutes 0 and empty action or why.
 */
export function importFiles(dir: string, files: PendingFile[]): void {
  for (const incoming of files) {
    mutate(dir, incoming.workspaceId, (file) => {
      const have = new Set(file.items.map((i) => `${i.agentId}\u0000${i.letter}`));
      for (const item of incoming.items) {
        if (!have.has(`${item.agentId}\u0000${item.letter}`)) file.items.push(item);
      }
      for (const [agent, letter] of Object.entries(incoming.highest)) {
        const known = file.highest[agent];
        if (!known || compareLetters(letter, known) > 0) file.highest[agent] = letter;
      }
      if (!file.cwd && incoming.cwd) file.cwd = incoming.cwd;
    });
  }
}
