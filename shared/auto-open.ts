// When the Pending panel opens by itself in a new workspace. Pure functions, so the
// once-only rule and the setting can be tested without a Paseo client.

/** A workspace counts as new for this long after it was created. */
export const NEW_WORKSPACE_MS = 10 * 60 * 1000;

/** How long a "panel opened for workspace X" record is kept. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * True when the panel should be opened for a workspace: the setting is on (it defaults on while
 * unsaved), the creation time is known and within the last 10 minutes, and this page has not
 * already asked for it.
 */
export function shouldAskToOpen(input: {
  autoOpenPanel: boolean | undefined;
  createdAt: string | null | undefined;
  now: Date;
  alreadyAsked: boolean;
}): boolean {
  if (input.autoOpenPanel === false || input.alreadyAsked || !input.createdAt) return false;
  const created = Date.parse(input.createdAt);
  if (Number.isNaN(created)) return false;
  const age = input.now.getTime() - created;
  return age >= -60_000 && age <= NEW_WORKSPACE_MS;
}

export type OpenedRecord = Record<string, string>;

/**
 * Records that the panel was opened for a workspace. Returns whether this call is the first one
 * (the caller opens the panel only then) and the record to save. Entries older than 30 days are
 * dropped.
 */
export function claimOpen(record: OpenedRecord, workspaceId: string, now: Date): { claimed: boolean; record: OpenedRecord } {
  const kept: OpenedRecord = {};
  for (const [id, at] of Object.entries(record)) {
    const t = Date.parse(at);
    if (!Number.isNaN(t) && now.getTime() - t <= KEEP_MS) kept[id] = at;
  }
  if (workspaceId in kept) return { claimed: false, record: kept };
  kept[workspaceId] = now.toISOString();
  return { claimed: true, record: kept };
}
