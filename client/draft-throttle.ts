// When to tell the server about a draft: on a change, and every 30 s while it is non-empty,
// never more often than every 10 s per agent. Pure, so tests drive the clock.

export const MIN_GAP_MS = 10_000;
export const REPEAT_MS = 30_000;

export class DraftThrottle {
  private last = new Map<string, { at: number; length: number }>();

  /** True when a report is due now; calling it with true records the report as sent. */
  take(agentId: string, length: number, now: number): boolean {
    const prev = this.last.get(agentId);
    if (!prev) {
      if (length === 0) return false; // nothing typed, nothing to say
    } else {
      if (now - prev.at < MIN_GAP_MS) return false;
      const changed = length !== prev.length;
      if (!changed && !(length > 0 && now - prev.at >= REPEAT_MS)) return false;
    }
    this.last.set(agentId, { at: now, length });
    return true;
  }
}
