// What a workspace's row in Paseo's sidebar shows, worked out apart from the
// drawing so it can be tested without React Native.

import { type TabLine, lineText } from "../shared/tabs-rpc.ts";
import type { Status } from "./palettes.ts";

export interface LineView {
  text: string;
  /** The dot's colour, or null for no dot. */
  colour: string | null;
}

/** The workspace's line, or null when it has none or the lines haven't arrived yet. */
export function lineView(
  lines: Record<string, TabLine> | undefined,
  workspaceId: string,
  dots: boolean,
  colours: Record<Status, string>,
): LineView | null {
  const line = lines?.[workspaceId];
  if (!line) return null;
  return { text: lineText(line), colour: dots && line.status ? colours[line.status] : null };
}
