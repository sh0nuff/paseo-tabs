// Agent tools: each Claude tab writes its own pending items into the
// per-workspace store. Every change goes through pending-store.ts.

import { z } from "zod";
import { defineAgentTool, type AgentToolContext, type AgentToolDefinition, type AgentToolResult } from "@getpaseo/plugin/server";
import { existsSync } from "node:fs";
import { cutoverMarker } from "./pending-rpc.ts";
import { addItem, finishItem, listOpen, updateItem } from "./pending-store.ts";

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

export function pendingTools(dir: string): AgentToolDefinition[] {
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
          return `Added item ${item.letter}.`;
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
  ];
}

type OpenRequest = { provider: string; tools: AgentToolDefinition[] };

/**
 * The `agent.open.before` hook: a Claude tab gets the pending tools only once the cut-over
 * marker exists, checked at every open so the cut-over needs no restart.
 */
export function pendingToolsHook(dir: string, tools: AgentToolDefinition[] = pendingTools(dir)) {
  return async <R extends OpenRequest>({ request }: { request: R }): Promise<R | undefined> => {
    if (request.provider !== "claude" || !existsSync(cutoverMarker(dir))) return undefined;
    return { ...request, tools: [...request.tools, ...tools] };
  };
}
