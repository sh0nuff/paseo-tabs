// One-time import of TABS.md items into the per-workspace pending store.
//
//   node tools/pending-import.ts <TABS.md path>           dry run: one count line per workspace
//   node tools/pending-import.ts <TABS.md path> --write   merge into the store (a re-run adds nothing)
//   options: --dir <store dir>  --home <Paseo home>
//
// Items keep their letters, so OpenTodo subtasks stay linked. Created and changed
// times are the import time: the TABS.md item clock is not carried over.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { highestBoxedLetter } from "../server/item-clock.ts";
import { loadState, paseoHome, type PaseoState } from "../server/paseo-state.ts";
import { type PendingFile, type PendingItem, type PendingKind, importFiles, localIso, pendingDir } from "../server/pending-store.ts";
import { GROUP_LINE, TAB_HEADING, hiddenLines, shortAgentId, shortWorkspaceId, splitSections } from "../server/tabs-file.ts";

const LABEL = /^\*\*(.+)\*\*\s*$/;
const ITEM = /^\s*[-*+]\s+([a-z]+)\)\s+\[([ xX])\]\s*(.*)$/;
const MINUTES = /\s*\(about (\d+) min\)\s*$/;
const TODO = /\s*\(OpenTodo task ([0-9a-f-]{8,})\)\s*$/i;

export type WorkspaceCount = { cwd: string; waiting: number; next: number; done: number; unmatched: number };

function parseItem(rest: string): { what: string; minutes: number; opentodo: string | null; struck: boolean } {
  let what = rest.trim();
  let opentodo: string | null = null;
  const todo = TODO.exec(what);
  if (todo) {
    opentodo = todo[1];
    what = what.slice(0, todo.index).trim();
  }
  let minutes = 0;
  const mins = MINUTES.exec(what);
  if (mins) {
    minutes = Number(mins[1]);
    what = what.slice(0, mins.index).trim();
  }
  const struck = /^~~(.*?)~~(?:\s.*)?$/s.exec(what);
  if (struck) what = struck[1].trim();
  return { what, minutes, opentodo, struck: !!struck };
}

export function analyzeTabs(text: string, state: PaseoState, now: Date): { files: PendingFile[]; counts: Map<string, WorkspaceCount> } {
  const stamp = localIso(now);
  const files = new Map<string, PendingFile>();
  const counts = new Map<string, WorkspaceCount>();
  const count = (short: string, cwd: string) => {
    let c = counts.get(short);
    if (!c) counts.set(short, (c = { cwd, waiting: 0, next: 0, done: 0, unmatched: 0 }));
    return c;
  };
  let group: { short: string; title: string } | null = null;
  for (const section of splitSections(text).sections) {
    const g = GROUP_LINE.exec(section.heading);
    if (g) {
      group = { title: g[1], short: g[2] };
      continue;
    }
    const tab = TAB_HEADING.exec(section.heading);
    if (!tab) continue;
    const agent = state.agents.find((a) => shortAgentId(a.id) === tab[2]);
    if (!agent || !agent.workspaceId) {
      count(group?.short ?? "unknown", "").unmatched++;
      continue;
    }
    const ws = state.workspaces.find((w) => w.id === agent.workspaceId);
    const cwd = ws?.cwd ?? agent.cwd;
    const wsShort = shortWorkspaceId(agent.workspaceId);
    const c = count(wsShort, cwd);
    c.cwd = cwd;
    let file = files.get(agent.workspaceId);
    if (!file) files.set(agent.workspaceId, (file = { workspaceId: agent.workspaceId, cwd, items: [], highest: {} }));

    const lines = section.body.split("\n");
    const hidden = hiddenLines(lines);
    let label = "";
    lines.forEach((line, i) => {
      if (hidden[i]) return;
      const l = LABEL.exec(line);
      if (l) {
        label = l[1];
        return;
      }
      const m = ITEM.exec(line);
      if (!m) return;
      const ticked = m[2] !== " ";
      const kind: PendingKind = label === "Claude's next steps" ? "next" : "waiting";
      if (!ticked && label !== "Waiting on you" && label !== "Claude's next steps") return;
      const p = parseItem(m[3]);
      const item: PendingItem = {
        letter: m[1], agentId: agent.id, kind, what: p.what, action: "", minutes: p.minutes, why: "",
        status: ticked ? "done" : "open", picked: false, created: stamp, changed: stamp,
        done: ticked ? stamp : null, note: null, opentodo: p.opentodo,
      };
      if (file.items.some((x) => x.agentId === agent.id && x.letter === item.letter)) return;
      file.items.push(item);
      if (ticked) c.done++;
      else c[kind]++;
    });
    const top = highestBoxedLetter(section.body);
    if (top) file.highest[agent.id] = top;
  }
  return { files: [...files.values()], counts };
}

export function importTabs(tabsText: string, state: PaseoState, now: Date): PendingFile[] {
  return analyzeTabs(tabsText, state, now).files;
}

function main(argv: string[]): void {
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const path = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--dir" && argv[i - 1] !== "--home");
  if (!path) {
    console.error("usage: node tools/pending-import.ts <TABS.md path> [--write] [--dir <dir>] [--home <dir>]");
    process.exit(2);
  }
  const dir = opt("--dir") ?? pendingDir(process.env);
  const state = loadState(opt("--home") ?? paseoHome(process.env));
  const { files, counts } = analyzeTabs(readFileSync(path, "utf8"), state, new Date());
  for (const [short, c] of counts) {
    console.log(`${short} ${c.cwd}: ${c.waiting} waiting, ${c.next} next, ${c.done} done, ${c.unmatched} unmatched sections`);
  }
  if (argv.includes("--write")) {
    importFiles(dir, files);
    console.log(`wrote ${files.length} workspace file(s) to ${dir}`);
  } else {
    console.log("dry run, nothing written (add --write)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
