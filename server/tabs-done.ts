// TABS-DONE.md: where a finished tab's section goes once it leaves TABS.md.
//
// A section moves, text unchanged and under its original heading, when its tab
// has been closed for 24 hours and nothing in it is open. It moves back, again
// unchanged, when its tab is active in Paseo again. This module is pure: it
// takes the two files' text and says what each should become. folder-sync.ts
// does the writing, in an order that can duplicate a section on a crash but
// never lose one.

import { GROUP_LINE, TAB_HEADING, hasOpenItems } from "./tabs-file.ts";

export const DONE_FILE = "TABS-DONE.md";
export const DONE_HEADER = "# Finished tabs (moved from TABS.md)";

export interface MoveContext {
  /** Short IDs of tabs closed for 24 hours. */
  closedShortIds: ReadonlySet<string>;
  /** Short IDs of tabs that are open in Paseo now. */
  activeShortIds: ReadonlySet<string>;
  /** Paseo's records could not be read, so every tab counts as open and nothing moves. */
  stateUnknown: boolean;
}

export interface MoveResult {
  tabs: string;
  done: string;
  /** Short IDs moved from TABS.md to TABS-DONE.md. */
  moved: string[];
  /** Short IDs moved back, or dropped from TABS-DONE.md because TABS.md already has them. */
  returned: string[];
}

interface Block {
  short: string | null; // null for anything that is not a tab section
  lines: string[];
}

/** Splits text into its preamble lines and one block of lines per heading, losing nothing. */
function blocks(text: string): { preamble: string[]; blocks: Block[] } {
  const lines = text.split("\n");
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith("## ") || GROUP_LINE.test(line)) starts.push(index);
  });
  if (starts.length === 0) return { preamble: lines, blocks: [] };
  return {
    preamble: lines.slice(0, starts[0]),
    blocks: starts.map((start, n) => {
      const part = lines.slice(start, n + 1 < starts.length ? starts[n + 1] : lines.length);
      return { short: TAB_HEADING.exec(part[0])?.[2] ?? null, lines: part };
    }),
  };
}

function trimmed(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

function sectionText(block: Block): string {
  return `${trimmed(block.lines).join("\n")}\n`;
}

function bodyOf(block: Block): string {
  return block.lines.slice(1).join("\n");
}

export function moveFinishedSections(tabsText: string, doneText: string, ctx: MoveContext): MoveResult {
  const tabs = blocks(tabsText);
  const done = blocks(doneText);
  const moved: string[] = [];
  const returned: string[] = [];
  const doneIds = new Set(done.blocks.flatMap((block) => block.short ?? []));
  const tabsIds = new Set(tabs.blocks.flatMap((block) => block.short ?? []));

  // Sections leaving TABS.md. One already in TABS-DONE.md, say after a crash, is not added twice.
  const leaving: Block[] = [];
  const kept: Block[] = [];
  for (const block of tabs.blocks) {
    const movable =
      !ctx.stateUnknown &&
      block.short !== null &&
      ctx.closedShortIds.has(block.short) &&
      !ctx.activeShortIds.has(block.short) &&
      !hasOpenItems(bodyOf(block));
    if (!movable) {
      kept.push(block);
      continue;
    }
    moved.push(block.short as string);
    if (!doneIds.has(block.short as string)) leaving.push(block);
  }

  // Sections coming back: their tab is active again.
  const stayingDone: Block[] = [];
  const coming: Block[] = [];
  for (const block of done.blocks) {
    if (!ctx.stateUnknown && block.short !== null && ctx.activeShortIds.has(block.short)) {
      returned.push(block.short);
      if (!tabsIds.has(block.short)) coming.push(block);
    } else {
      stayingDone.push(block);
    }
  }

  const rebuiltTabs = [...tabs.preamble, ...kept.flatMap((block) => block.lines)];
  let tabsOut = rebuiltTabs.join("\n");
  if (coming.length > 0) {
    const head = trimmed(rebuiltTabs);
    tabsOut = `${head.length > 0 ? `${head.join("\n")}\n\n` : ""}${coming.map(sectionText).join("\n")}`;
  }

  let doneOut = doneText;
  if (leaving.length > 0 || returned.length > 0) {
    const sections = [...leaving, ...stayingDone].map(sectionText);
    doneOut = sections.length === 0 ? `${DONE_HEADER}\n` : `${DONE_HEADER}\n\n${sections.join("\n")}`;
  }
  return { tabs: moved.length === 0 && returned.length === 0 ? tabsText : tabsOut, done: doneOut, moved, returned };
}
