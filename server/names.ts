// Shorter display names for tabs and workspaces whose names are still long,
// usually because Paseo named them after the first message. The name in Paseo
// is never changed here; this only shapes how TABS.md and the panel show it.

const OPENERS = [
  /^(?:hey|hi|hello)\b[^.!?]*[.!?]\s+/i,
  /^(?:i need to|i want to|i'd like to|i would like to|i'm curious about|i am curious about|can you|could you|please|let's)\s+/i,
];
// Where a clause ends: sentence punctuation or a comma before a space, or a spaced dash or colon.
const CLAUSE_END = /[.!?,](?=\s)|\s[-:]\s/g;
const MIN_CLAUSE = 12;
const TRAILING = /[\s.,;:!?-]+$/;

export function shortenName(name: string, max: number): string {
  const collapsed = name.split(/\s+/).filter(Boolean).join(" ");
  if (collapsed.length <= max) return collapsed;

  let text = collapsed.replace(/[`"“”]/g, "").split(/\s+/).filter(Boolean).join(" ");
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
  if (text.length <= max) return text;

  const space = text.slice(0, max).lastIndexOf(" ");
  const head = (space > 0 ? text.slice(0, space) : text.slice(0, max - 1)).replace(TRAILING, "");
  return `${head}…`;
}
