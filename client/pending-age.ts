/** "Waiting since today", "Waiting 1 day" or "Waiting N days", by whole days since created. */
export function waitingLabel(created: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(created)) / (24 * 3600 * 1000)));
  if (days === 0) return "Waiting since today";
  return days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
}
