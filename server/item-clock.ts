// Remembers when each item waiting on the user last changed, so one that sits
// unchanged past the user's limit can turn its tab red. TABS.md carries no
// dates; this keeps them in the plugin's own small file instead. An item is
// known by its tab and its letter: rewording it restarts its clock, and ticking
// it off or removing it forgets it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isOpenItem } from "./tabs-file.ts";

const DAY_MS = 24 * 3600 * 1000;
const LABEL = /^\*\*.+\*\*\s*$/;
const BOXED_ITEM = /^\s*[-*+]\s+(?:([a-z]+)\)\s+)?\[ \]\s+(.*)$/;

/** Where the plugin keeps item ages: $XDG_STATE_HOME/paseo-tabs, else ~/.local/state/paseo-tabs. */
export function clockPath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME ?? homedir(), ".local", "state");
  return join(state, "paseo-tabs", "items.json");
}

export interface WaitingItem {
  key: string;
  text: string;
}

/** Open items under a section's "Waiting on you", keyed by letter, or by text when unlettered. */
export function waitingItems(body: string): WaitingItem[] {
  const items: WaitingItem[] = [];
  let inside = false;
  for (const line of body.split("\n")) {
    if (LABEL.test(line)) {
      inside = line.trim() === "**Waiting on you**";
      continue;
    }
    if (!inside || !isOpenItem(line)) continue;
    const boxed = BOXED_ITEM.exec(line);
    const text = (boxed ? boxed[2] : line.trim().replace(/^[-*+]\s+/, "")).trim();
    items.push({ key: boxed?.[1] ?? `#${text}`, text });
  }
  return items;
}

interface Entry {
  text: string;
  since: string;
}

function readEntries(path: string): Record<string, Entry> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed.items === "object" && parsed.items !== null ? parsed.items : {};
  } catch {
    return {}; // first run, or an unreadable file: every item starts fresh
  }
}

export class ItemClock {
  private readonly path: string | null;
  private readonly entries: Record<string, Entry>;
  private dirty = false;

  /** With no path the clock lives in memory only. */
  constructor(path: string | null) {
    this.path = path;
    this.entries = path ? readEntries(path) : {};
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

  /** Forgets every tab not in seen, such as tabs whose sections are gone. */
  prune(seen: Set<string>): void {
    for (const key of Object.keys(this.entries)) {
      if (!seen.has(key.slice(0, key.indexOf(":")))) {
        delete this.entries[key];
        this.dirty = true;
      }
    }
  }

  save(): void {
    if (!this.path || !this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ version: 1, items: this.entries }, null, 2)}\n`);
    this.dirty = false;
  }
}
