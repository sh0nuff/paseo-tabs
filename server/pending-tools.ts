// Agent tools: each Claude tab writes its own pending items into the
// per-workspace store. Every change goes through pending-store.ts.

import { z } from "zod";
import { defineAgentTool, type AgentToolContext, type AgentToolDefinition, type AgentToolResult } from "@getpaseo/plugin/server";
import { autoArchiveFor, modeFor } from "../shared/install-state.mjs";
import { registryPath } from "./archived-tabs.ts";
import { findTabs, isArchived } from "./auto-archive.ts";
import { loadState, paseoHome } from "./paseo-state.ts";
import { addItem, finishItem, listOpen, updateItem } from "./pending-store.ts";
import { startRestore } from "./workspace-control.ts";

const kind = z.enum(["waiting", "next"]);
const minutes = z.number().int().positive();

const failure = (text: string): AgentToolResult => ({ isError: true, text });

function guarded(run: (workspaceId: string, context: AgentToolContext) => string) {
  return (context: AgentToolContext): AgentToolResult => {
    const workspaceId = context.agent.workspaceId;
    if (!workspaceId) return failure("This tab has no workspace.");
    try {
      return { text: run(workspaceId, context) };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  };
}

export type ToolOptions = {
  /** Paseo's home folder, for the workspace records. */
  home?: string;
  /** archived-tabs.json. */
  registry?: string;
  /** Brings an archived workspace back; runs in the background by default. */
  restore?: (workspaceId: string) => void;
  /** Whether auto-archive is on, asked at each add; by default from the saved settings and the store folder. */
  autoArchive?: () => boolean;
};

export function pendingTools(dir: string, options: ToolOptions = {}): AgentToolDefinition[] {
  const home = options.home ?? paseoHome(process.env);
  const registry = options.registry ?? registryPath(process.env);
  const restore = options.restore ?? ((id: string) => startRestore(id, process.env));
  const autoArchive = options.autoArchive ?? (() => autoArchiveFor(dir, {}));
  return [
    defineAgentTool({
      name: "pending_add",
      description:
        "Add an item to this tab's pending list. kind 'waiting' is something the user must do or decide; 'next' is your own next step. All four fields are required: what (the item in words), action (what the user does), minutes (how long the user's part takes), why (why it matters).",
      input: z.object({
        kind,
        what: z.string().min(1).describe("The item in words"),
        action: z.string().min(1).describe("What the user does"),
        minutes: minutes.describe("How long the user's part takes"),
        why: z.string().min(1).describe("Why it matters"),
      }),
      execute: (input, context) =>
        guarded((ws, c) => {
          const item = addItem(dir, ws, c.agent.cwd, c.agent.id, input, new Date());
          let archived = false;
          try {
            // Only new work waiting on the user brings an archived workspace back, and only with auto-archive on.
            archived = input.kind === "waiting" && autoArchive() && isArchived(loadState(home), ws);
          } catch {
            // the item is stored either way
          }
          if (archived) restore(ws);
          return archived ? `Added item ${item.letter}. This workspace was archived and is being restored.` : `Added item ${item.letter}.`;
        })(context),
    }),
    defineAgentTool({
      name: "pending_update",
      description: "Change fields of one of this tab's pending items by letter. Give only the fields that change.",
      input: z.object({
        letter: z.string().min(1),
        kind: kind.optional(),
        what: z.string().min(1).optional(),
        action: z.string().min(1).optional(),
        minutes: minutes.optional(),
        why: z.string().min(1).optional(),
      }),
      execute: ({ letter, ...patch }, context) =>
        guarded((ws, c) => {
          if (Object.values(patch).every((v) => v === undefined)) throw new Error("Nothing to update.");
          updateItem(dir, ws, c.agent.id, letter, patch, new Date());
          return `Updated item ${letter}.`;
        })(context),
    }),
    defineAgentTool({
      name: "pending_done",
      description: "Close one of this tab's pending items by letter: status 'done' when finished, 'dropped' when no longer needed. note is optional.",
      input: z.object({ letter: z.string().min(1), status: z.enum(["done", "dropped"]), note: z.string().optional() }),
      execute: ({ letter, status, note }, context) =>
        guarded((ws, c) => {
          finishItem(dir, ws, c.agent.id, letter, status, note ?? null, new Date());
          return `Item ${letter} is ${status}.`;
        })(context),
    }),
    defineAgentTool({
      name: "pending_list",
      description: "List the open pending items of this tab, one line each. Only this tab's items are listed.",
      input: z.object({}),
      execute: (_input, context) =>
        guarded((ws, c) => {
          const lines = listOpen(dir, ws, new Date())
            .filter((i) => i.status === "open" && i.agentId === c.agent.id)
            .map((i) => `${i.letter}) ${i.what} (about ${i.minutes} min)`);
          return lines.length ? lines.join("\n") : "No open items.";
        })(context),
    }),
    defineAgentTool({
      name: "pending_find",
      description:
        "Find other tabs to hand work to: live ones, and ones whose workspace was archived when nothing was left waiting (kept 30 days). Matches every word against the workspace name and tab title, or as the start of an agent or workspace id. One JSON line per tab. Then message the tab with send_agent_prompt (an archived tab runs, its workspace stays archived), or add an item waiting on the user for it, which brings its workspace back.",
      input: z.object({ query: z.string().describe("Words from the workspace name or tab title, or an id prefix; empty lists all") }),
      execute: ({ query }) => {
        try {
          const rows = findTabs(loadState(home), registry, query, new Date());
          return { text: rows.length ? rows.map((r) => JSON.stringify(r)).join("\n") : "No matching tabs." };
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
    }),
  ];
}

type OpenRequest = { provider: string; tools: AgentToolDefinition[] };

/**
 * The `agent.open.before` hook: every tab gets the pending tools in mode "pending", whatever its
 * provider, checked at every open so switching the mode needs no restart. Paseo delivers them by
 * MCP or native registration as the provider supports; one that takes neither simply goes
 * without (unlike plugin MCP servers, attached tools never fail an open).
 */
export function pendingToolsHook(
  dir: string,
  tools: AgentToolDefinition[] = pendingTools(dir),
  enabled: () => boolean = () => modeFor(dir, {}) === "pending",
) {
  return async <R extends OpenRequest>({ request }: { request: R }): Promise<R | undefined> => {
    if (!enabled()) return undefined;
    return { ...request, tools: [...request.tools, ...tools] };
  };
}
