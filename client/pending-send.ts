/** What the sender needs from a Paseo agent handle. */
export interface SenderAgent {
  refresh(): Promise<unknown>;
  status: string | null;
  send(text: string, options?: { activeTurnBehavior: "steer" }): Promise<unknown>;
}

/**
 * Sends text at once. The status is refreshed one time: a running tab gets the message steered
 * into its turn (a plain send from a user client would interrupt it), any other status gets a
 * plain send. A failed refresh rejects and nothing is sent.
 */
export async function sendNow(agent: SenderAgent, text: string): Promise<void> {
  await agent.refresh();
  if (agent.status === "running") await agent.send(text, { activeTurnBehavior: "steer" });
  else await agent.send(text);
}

/**
 * Sends a picked item's message at once. When the send fails, calls unpick so the item can be
 * picked again, then rejects with the send's error. A failed unpick is added to that error
 * rather than hiding it.
 */
export async function sendPicked(agent: SenderAgent, text: string, unpick: () => Promise<unknown>): Promise<void> {
  try {
    await sendNow(agent, text);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      await unpick();
    } catch (undo) {
      throw new Error(`${failure.message} The pick could not be cleared either: ${undo instanceof Error ? undo.message : String(undo)}`);
    }
    throw failure;
  }
}
