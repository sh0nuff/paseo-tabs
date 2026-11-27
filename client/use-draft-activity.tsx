import { useAgents, useComposers, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import { pendingActivity } from "../shared/activity-rpc.ts";
import { DraftThrottle } from "./draft-throttle.ts";

// One throttle for the whole page, so a tab watched from several places reports once.
const throttle = new DraftThrottle();
const TICK_MS = 5000;

/**
 * Watches one agent's composer and reports typing to the server through pending.activity:
 * when the unsent text changes, and every 30 s while it is non-empty, at most once per
 * 10 s per agent. (useComposers takes one agent, so a list goes through DraftActivity.)
 */
export function useDraftActivity(agentId: string): void {
  const report = useRpc(pendingActivity);
  const [composer] = useComposers({ agentId });
  const length = composer ? composer.prompt.length : 0;
  const latest = useRef({ length, report });
  latest.current = { length, report };
  const send = () => {
    const { length: n, report: r } = latest.current;
    if (throttle.take(agentId, n, Date.now())) void r({ agentId, draftLength: n }).catch(() => {});
  };
  // On a change at once; the timer sends what the throttle held back, and the 30 s repeat.
  useEffect(send, [length]);
  useEffect(() => {
    const t = setInterval(send, TICK_MS);
    return () => clearInterval(t);
  }, [agentId]);
}

function Watcher({ agentId }: { agentId: string }) {
  useDraftActivity(agentId);
  return null;
}

/** Watches the composers of these agents; renders nothing. */
export function DraftActivity({ agentIds }: { agentIds: readonly string[] }) {
  return (
    <>
      {agentIds.map((id) => (
        <Watcher key={id} agentId={id} />
      ))}
    </>
  );
}

/** The composer item: it renders nothing, and watches every agent the app lists. */
export function ComposerDraftActivity() {
  const ids = useAgents().map((a) => a.id);
  return <DraftActivity agentIds={ids} />;
}
