// Shorter display names for tabs and workspaces whose names are still long,
// usually because Paseo named them after the first message. The name in Paseo
// is never changed here; this only shapes how TABS.md and the panel show it.
// Lengths are counted in characters, not UTF-16 units, so an emoji is never cut
// in half.

const OPENERS = [
  // A short greeting, alone or before the request: "Hey Claude, ", "Hi, ", "Hello Sam. ".
  /^(?:hey|hi|hello)\b[^,.!?]{0,20}[,.!?]\s+/i,
  /^(?:i need to|i want to|i'd like to|i would like to|i'm curious about|i am curious about|can you|could you|please|let's)\s+/i,
];
// Where a clause ends: sentence punctuation or a comma before a space, or a spaced dash or colon.
const CLAUSE_END = /[.!?,](?=\s)|\s[-:]\s/g;
const MIN_CLAUSE = 12;
const TRAILING = /[\s.,;:!?-]+$/;

const chars = (text: string) => Array.from(text);
const oneLine = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
const hardCut = (text: string, max: number) => `${chars(text).slice(0, max - 1).join("")}…`;

export function shortenName(name: string, max: number): string {
  const collapsed = oneLine(name);
  if (chars(collapsed).length <= max) return collapsed;

  let text = oneLine(collapsed.replace(/[`"“”]/g, ""));
  for (const opener of OPENERS) {
    const rest = text.replace(opener, "");
    if (rest !== text && rest) text = rest[0].toUpperCase() + rest.slice(1);
  }

  for (const end of text.matchAll(CLAUSE_END)) {
    if (end.index >= MIN_CLAUSE) {
      text = text.slice(0, end.index);
      break;
    }
  }
  text = text.replace(TRAILING, "");
  if (!text) return hardCut(collapsed, max);
  if (chars(text).length <= max) return text;

  const window = chars(text).slice(0, max).join("");
  const space = window.lastIndexOf(" ");
  const head = (space > 0 ? window.slice(0, space) : chars(text).slice(0, max - 1).join("")).replace(TRAILING, "");
  return head ? `${head}…` : hardCut(collapsed, max);
}
