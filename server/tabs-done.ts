// TABS-DONE.md: where a finished tab's section goes once it leaves TABS.md.
//
// A section moves, text unchanged and under its original heading, when its tab
// has been closed for 24 hours and nothing in it is open. It moves back, again
// unchanged, when its tab is active in Paseo again. This module is pure: it
// takes the two files' text and says what each should become. folder-sync.ts
// does the writing, in an order that can duplicate a section on a crash but
// never lose one.

import { GROUP_LINE, TAB_HEADING, hasOpenItems, hiddenLines } from "./tabs-file.ts";

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

/**
 * Splits text into its preamble lines and one block of lines per tab heading or group
 * line, losing nothing. A "## " line that is not a tab heading, and any line inside a
 * code block or comment, belongs to the block before it, so a section is never cut in
 * two: it moves or stays whole, and an open item anywhere in it keeps all of it.
 */
function blocks(text: string): { preamble: string[]; blocks: Block[] } {
  const lines = text.split("\n");
  const hidden = hiddenLines(lines);
  const preamble: string[] = [];
  const out: Block[] = [];
  lines.forEach((line, index) => {
    const tab = hidden[index] ? null : TAB_HEADING.exec(line);
    const group = !hidden[index] && GROUP_LINE.test(line);
    const stray = !hidden[index] && line.startsWith("## ") && !tab && out.length === 0;
    if (tab || group || stray) {
      out.push({ short: tab?.[2] ?? null, lines: [line] });
    } else if (out.length === 0) {
      preamble.push(line);
    } else {
      out[out.length - 1].lines.push(line);
    }
  });
  return { preamble, blocks: out };
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

// Headings are compared by nothing: the plugin may have rewritten the dot or the number since.
const sameText = (a: Block, b: Block) => trimmed(a.lines.slice(1)).join("\n") === trimmed(b.lines.slice(1)).join("\n");

export function moveFinishedSections(tabsText: string, doneText: string, ctx: MoveContext): MoveResult {
  const tabs = blocks(tabsText);
  const done = blocks(doneText);
  const moved: string[] = [];
  const returned: string[] = [];
  const firstInTabs = new Map<string, Block>();
  for (const block of tabs.blocks) if (block.short !== null && !firstInTabs.has(block.short)) firstInTabs.set(block.short, block);

  // Sections leaving TABS.md. Only the first block of a short ID moves. If TABS-DONE.md
  // already has the ID, say after a crash, the copy from TABS.md replaces it: it is the
  // live one, so the newer.
  const leaving: Block[] = [];
  const kept: Block[] = [];
  const taken = new Set<string>();
  for (const block of tabs.blocks) {
    const movable =
      !ctx.stateUnknown &&
      block.short !== null &&
      firstInTabs.get(block.short) === block &&
      ctx.closedShortIds.has(block.short) &&
      !ctx.activeShortIds.has(block.short) &&
      !hasOpenItems(bodyOf(block));
    if (!movable) {
      kept.push(block);
      continue;
    }
    moved.push(block.short as string);
    taken.add(block.short as string);
    leaving.push(block);
  }

  // Sections coming back: their tab is active again. A copy TABS.md already has is
  // dropped only if it is identical. If the tab has written since, the history stays.
  const stayingDone: Block[] = [];
  const coming: Block[] = [];
  for (const block of done.blocks) {
    if (block.short !== null && taken.has(block.short)) continue; // replaced by the live copy
    const live = block.short === null ? undefined : firstInTabs.get(block.short);
    if (!ctx.stateUnknown && block.short !== null && ctx.activeShortIds.has(block.short)) {
      if (live === undefined) {
        returned.push(block.short);
        coming.push(block);
        continue;
      }
      if (sameText(live, block)) {
        returned.push(block.short);
        continue;
      }
    }
    stayingDone.push(block);
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
