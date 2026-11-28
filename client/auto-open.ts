import { shouldAskToOpen } from "../shared/auto-open.ts";

let opener: ((workspaceId: string) => void) | null = null;
// Workspaces this page has already asked about, so a row that re-renders asks once.
const asked = new Set<string>();

/** Set by the plugin's client entry; the workspace row badge has no client of its own. */
export function setPanelOpener(fn: ((workspaceId: string) => void) | null): void {
  opener = fn;
}

export function resetAsked(): void {
  asked.clear();
}

/**
 * Opens the Pending panel for a workspace created in the last 10 minutes, once. The server's
 * answer decides, so another device that already did it, or a mode without the panel, means no.
 */
export async function maybeOpenPanel(input: {
  workspaceId: string;
  createdAt: string | null | undefined;
  autoOpenPanel: boolean | undefined;
  now: Date;
  claim: (input: { workspaceId: string }) => Promise<{ claimed: boolean }>;
}): Promise<boolean> {
  const { workspaceId } = input;
  if (!opener || !shouldAskToOpen({ ...input, alreadyAsked: asked.has(workspaceId) })) return false;
  asked.add(workspaceId);
  try {
    const { claimed } = await input.claim({ workspaceId });
    if (!claimed) return false;
    opener?.(workspaceId);
    return true;
  } catch {
    // The server was not reachable; the next page load asks again if the workspace is still new.
    asked.delete(workspaceId);
    return false;
  }
}
