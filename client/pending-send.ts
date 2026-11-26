/** What the sender needs from a Paseo agent handle. */
export interface SenderAgent {
  refresh(): Promise<unknown>;
  status: string | null;
  send(text: string): Promise<unknown>;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SendOptions {
  /** Senders with the same key replace each other. Use the workspace id. */
  key?: string;
  timers?: Timers;
  intervalMs?: number;
  /** How long an unknown status is tolerated before giving up. */
  giveUpMs?: number;
}

export interface Sender {
  cancel(): void;
  done: Promise<void>;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const active = new Map<string, Sender>();

/**
 * Sends text once the agent is not running. A send to a running agent
 * interrupts its turn, so this polls refresh() rather than relying on
 * subscriptions. Any status but "running" counts as free; null (unknown) keeps
 * polling until giveUpMs. A new call with the same key cancels the earlier one.
 */
export function sendWhenIdle(agent: SenderAgent, text: string, options: SendOptions = {}): Sender {
  const key = options.key ?? "default";
  const timers = options.timers ?? realTimers;
  const interval = options.intervalMs ?? 2000;
  const giveUp = options.giveUpMs ?? 10 * 60 * 1000;
  active.get(key)?.cancel();

  let cancelled = false;
  let finished = false;
  let handle: unknown;
  let unknownMs = 0;
  let settle: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const sender: Sender = {
    done,
    cancel() {
      if (finished) return;
      cancelled = true;
      finished = true;
      if (handle !== undefined) timers.clear(handle);
      if (active.get(key) === sender) active.delete(key);
      settle();
    },
  };
  active.set(key, sender);

  const end = (error?: Error) => {
    finished = true;
    if (active.get(key) === sender) active.delete(key);
    if (error) fail(error);
    else settle();
  };

  const poll = async (): Promise<void> => {
    handle = undefined;
    if (cancelled) return;
    try {
      await agent.refresh();
      if (cancelled) return;
      const status = agent.status;
      if (status === "running" || status === null) {
        if (status === null) unknownMs += interval;
        else unknownMs = 0;
        if (unknownMs >= giveUp) return end(new Error("The tab did not report its status, so nothing was sent."));
        handle = timers.set(() => void poll(), interval);
        return;
      }
      finished = true;
      await agent.send(text);
      end();
    } catch (error) {
      end(error instanceof Error ? error : new Error(String(error)));
    }
  };
  void poll();
  return sender;
}
