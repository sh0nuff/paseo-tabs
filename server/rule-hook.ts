// Gives every tab the rule, whatever its provider, by appending it to the system prompt at
// each session open. Claude tabs that also have the Claude Code plugin would get it a second
// time from its SessionStart hook, so the open also sets PASEO_TABS_RULE_APPENDED=1 in the
// tab's environment and that hook then stays silent.

import { RULE_APPENDED_ENV } from "../lib/rules.mjs";

type OpenRequest = {
  agentId: string;
  cwd: string;
  purpose: "interactive" | "history";
  appendSystemPrompt?: string[];
  env: Record<string, string>;
};

/** `rule` returns the filled rule for a tab, or null when the tab gets none (outside a repo's top level). */
export function ruleHook(rule: (agentId: string, cwd: string) => string | null) {
  return async <R extends OpenRequest>({ request }: { request: R }): Promise<R | undefined> => {
    // History opens ignore instructions.
    if (request.purpose === "history") return undefined;
    let text: string | null;
    try {
      text = rule(request.agentId, request.cwd);
    } catch (error) {
      // A throw would fail the open; a tab without the rule still works.
      console.error("paseo-tabs: could not build the rule:", error);
      return undefined;
    }
    if (!text) return undefined;
    return {
      ...request,
      appendSystemPrompt: [...(request.appendSystemPrompt ?? []), text],
      env: { ...request.env, [RULE_APPENDED_ENV]: "1" },
    };
  };
}
