// Remembers when each item waiting on the user last changed, so one that sits
// unchanged past the user's limit can turn its tab red. TABS.md carries no
// dates; this keeps them in the plugin's own small file instead. An item is
// known by its tab and its letter: rewording it restarts its clock, and ticking
// it off or removing it forgets it.
//
// It also remembers when each finished item was first seen ticked, so the item
// can leave TABS.md a day later. Unticking an item forgets its tick.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hiddenLines, isOpenItem } from "./tabs-file.ts";

const DAY_MS = 24 * 3600 * 1000;
const LABEL = /^\*\*.+\*\*\s*$/;
const BOXED_ITEM = /^\s*[-*+]\s+(?:([a-z]+)\)\s+)?\[ \]\s+(.*)$/;
const TICKED_ITEM = /^\s*[-*+]\s+([a-z]+)\)\s+\[x\]/;

/**
 * Where the plugin keeps item ages: $XDG_STATE_HOME/paseo-tabs, else
 * ~/.local/state/paseo-tabs. Each Paseo home gets its own file, so two daemons
 * run by one user never overwrite each other's clocks.
 */
export function clockPath(env: Record<string, string | undefined>, home: string): string {
  const state = env.XDG_STATE_HOME || join(env.HOME ?? homedir(), ".local", "state");
  const id = createHash("sha1").update(resolve(home)).digest("hex").slice(0, 8);
  return join(state, "paseo-tabs", `items-${id}.json`);
}

export interface WaitingItem {
  key: string;
  text: string;
}

/** Open items under a section's "Waiting on you", keyed by letter, or by text when unlettered. */
export function waitingItems(body: string): WaitingItem[] {
  const items: WaitingItem[] = [];
  const keys = new Set<string>();
  let inside = false;
  for (const line of body.split("\n")) {
    if (LABEL.test(line)) {
      inside = line.trim() === "**Waiting on you**";
      continue;
    }
    if (!inside || !isOpenItem(line)) continue;
    const boxed = BOXED_ITEM.exec(line);
    const text = (boxed ? boxed[2] : line.trim().replace(/^[-*+]\s+/, "")).trim();
    let key = boxed?.[1] ?? `#${text}`;
    // A letter used twice, say after a hand edit, still gives each item its own clock.
    if (boxed?.[1] && keys.has(key)) key = `${boxed[1]}#${text}`;
    keys.add(key);
    items.push({ key, text });
  }
  return items;
}

/** Letters of the ticked items anywhere in a section, each once, leaving out code blocks and comments. */
export function tickedLetters(body: string): string[] {
  const lines = body.split("\n");
  const hidden = hiddenLines(lines);
  const letters = new Set<string>();
  lines.forEach((line, index) => {
    const ticked = hidden[index] ? null : TICKED_ITEM.exec(line);
    if (ticked) letters.add(ticked[1]);
  });
  return [...letters];
}

interface Entry {
  text: string;
  since: string;
}

interface Saved {
  items: Record<string, Entry>;
  /** When each finished item was first seen ticked, keyed "<short>:<letter>". */
  ticked: Record<string, string>;
}

function readSaved(path: string): Saved {
  let parsed: { items?: unknown; ticked?: unknown } | null;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { items: {}, ticked: {} }; // first run, or an unreadable file: every item starts fresh
  }
  const saved: Saved = { items: {}, ticked: {} };
  const items = parsed?.items;
  if (typeof items === "object" && items !== null) {
    for (const [key, entry] of Object.entries(items)) {
      // An entry without its text or a readable date starts that item fresh.
      if (typeof entry?.text === "string" && typeof entry.since === "string" && !Number.isNaN(Date.parse(entry.since))) {
        saved.items[key] = { text: entry.text, since: entry.since };
      }
    }
  }
  const ticked = parsed?.ticked;
  if (typeof ticked === "object" && ticked !== null) {
    for (const [key, since] of Object.entries(ticked)) {
      // A tick without a readable date starts that item's day again.
      if (typeof since === "string" && !Number.isNaN(Date.parse(since))) saved.ticked[key] = since;
    }
  }
  return saved;
}

export class ItemClock {
  private readonly path: string | null;
  private readonly entries: Record<string, Entry>;
  private readonly ticked: Record<string, string>;
  private dirty = false;

  /** With no path the clock lives in memory only. */
  constructor(path: string | null) {
    this.path = path;
    const saved = path ? readSaved(path) : { items: {}, ticked: {} };
    this.entries = saved.items;
    this.ticked = saved.ticked;
  }

  /** Records the tab's current waiting items and returns how many are overdue. A limit of 0 means never. */
  observe(short: string, body: string, now: Date, overdueAfterDays: number): number {
    const prefix = `${short}:`;
    const current = new Set<string>();
    let overdue = 0;
    for (const item of waitingItems(body)) {
      const key = prefix + item.key;
      current.add(key);
      const entry = this.entries[key];
      if (!entry || entry.text !== item.text) {
        this.entries[key] = { text: item.text, since: now.toISOString() };
        this.dirty = true;
      } else if (overdueAfterDays > 0 && now.getTime() - Date.parse(entry.since) > overdueAfterDays * DAY_MS) {
        overdue++;
      }
    }
    for (const key of Object.keys(this.entries)) {
      if (key.startsWith(prefix) && !current.has(key)) {
        delete this.entries[key];
        this.dirty = true;
      }
    }
    return overdue;
  }

  /** Records the tab's ticked items and returns the letters ticked for longer than keepMs. */
  expiredTicks(short: string, body: string, now: Date, keepMs: number): Set<string> {
    const prefix = `${short}:`;
    const current = new Set(tickedLetters(body).map((letter) => prefix + letter));
    const expired = new Set<string>();
    for (const key of current) {
      const since = this.ticked[key];
      if (since === undefined) {
        this.ticked[key] = now.toISOString();
        this.dirty = true;
      } else if (now.getTime() - Date.parse(since) > keepMs) {
        expired.add(key.slice(prefix.length));
      }
    }
    for (const key of Object.keys(this.ticked)) {
      if (key.startsWith(prefix) && !current.has(key)) {
        delete this.ticked[key];
        this.dirty = true;
      }
    }
    return expired;
  }

  /** Forgets every tab not in seen, such as tabs whose sections are gone. */
  prune(seen: Set<string>): void {
    for (const kept of [this.entries, this.ticked]) {
      for (const key of Object.keys(kept)) {
        if (!seen.has(key.slice(0, key.indexOf(":")))) {
          delete kept[key];
          this.dirty = true;
        }
      }
    }
  }

  /** The earliest moment from nowMs at which an item turns overdue, or null if none will. */
  nextDue(overdueAfterDays: number, nowMs: number): number | null {
    if (overdueAfterDays <= 0) return null;
    let next: number | null = null;
    for (const entry of Object.values(this.entries)) {
      const due = Date.parse(entry.since) + overdueAfterDays * DAY_MS;
      if (due >= nowMs && (next === null || due < next)) next = due;
    }
    return next;
  }

  /** The earliest moment from nowMs at which a ticked item has been ticked for keepMs, or null. */
  nextTickExpiry(keepMs: number, nowMs: number): number | null {
    let next: number | null = null;
    for (const since of Object.values(this.ticked)) {
      const expiry = Date.parse(since) + keepMs;
      if (expiry >= nowMs && (next === null || expiry < next)) next = expiry;
    }
    return next;
  }

  save(): void {
    if (!this.path || !this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    // Written beside the file and renamed over it, so a crash never leaves half a file.
    const scratch = `${this.path}.${process.pid}.tmp`;
    writeFileSync(scratch, `${JSON.stringify({ version: 1, items: this.entries, ticked: this.ticked }, null, 2)}\n`, { mode: 0o600 });
    renameSync(scratch, this.path);
    this.dirty = false;
  }
}
