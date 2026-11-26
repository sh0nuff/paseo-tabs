import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolDefinition } from "@getpaseo/plugin/server";
import { pendingTools, pendingToolsHook } from "../server/pending-tools.ts";
import { addItem, pendingDir, readPending } from "../server/pending-store.ts";
import { tempDir } from "./helpers.ts";

const ctx = (id = "A", workspaceId: string | null = "w") => ({ agent: { id, workspaceId, cwd: "/c" }, signal: new AbortController().signal }) as never;
const F = { kind: "waiting" as const, what: "Pick", action: "Choose one", minutes: 5, why: "Blocks work" };
const tool = (dir: string, name: string) => {
  const t = pendingTools(dir).find((x) => x.name === name)!;
  return (input: unknown, c = ctx()) => (t as never as { execute: (i: unknown, c: unknown) => Promise<{ text?: string; isError?: boolean }> }).execute(t.input ? (t as never as { input: { parse(i: unknown): unknown } }).input.parse(input) : input, c);
};

test("exposes the four tools", (t) => {
  assert.deepEqual(pendingTools(tempDir(t)).map((x) => x.name), ["pending_add", "pending_update", "pending_done", "pending_list"]);
});

test("pending_add names the new letter and stores cwd", async (t) => {
  const dir = tempDir(t);
  const r = await tool(dir, "pending_add")(F);
  assert.match(r.text!, /\ba\b/);
  assert.equal(r.isError, undefined);
  assert.equal(readPending(dir, "w").cwd, "/c");
});

test("pending_add needs a workspace", async (t) => {
  const r = await tool(tempDir(t), "pending_add")(F, ctx("A", null));
  assert.equal(r.isError, true);
  assert.equal(r.text, "This tab has no workspace.");
});

test("pending_add with a missing field errors", async (t) => {
  assert.throws(() => tool(tempDir(t), "pending_add")({ ...F, action: undefined }));
});

test("pending_update changes an item, unknown letter is an error", async (t) => {
  const dir = tempDir(t);
  await tool(dir, "pending_add")(F);
  const ok = await tool(dir, "pending_update")({ letter: "a", minutes: 9 });
  assert.equal(ok.isError, undefined);
  assert.equal(readPending(dir, "w").items[0].minutes, 9);
  const bad = await tool(dir, "pending_update")({ letter: "z", minutes: 9 });
  assert.equal(bad.isError, true);
});

test("pending_done finishes; unknown letter is an error", async (t) => {
  const dir = tempDir(t);
  await tool(dir, "pending_add")(F);
  const ok = await tool(dir, "pending_done")({ letter: "a", status: "done", note: "fine" });
  assert.equal(ok.isError, undefined);
  assert.equal(readPending(dir, "w").items[0].status, "done");
  const bad = await tool(dir, "pending_done")({ letter: "q", status: "dropped" });
  assert.equal(bad.isError, true);
});

test("pending_list gives one line per open item", async (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", F, new Date());
  addItem(dir, "w", "/c", "A", { ...F, what: "Other", minutes: 2 }, new Date());
  addItem(dir, "w", "/c", "A", { ...F, what: "Gone" }, new Date());
  await tool(dir, "pending_done")({ letter: "c", status: "dropped" });
  const r = await tool(dir, "pending_list")({});
  assert.deepEqual(r.text!.split("\n"), ["a) Pick (about 5 min)", "b) Other (about 2 min)"]);
  assert.equal((await tool(dir, "pending_list")({}, ctx("A", "empty"))).text, "No open items.");
});

test("a corrupt store comes back as a tool error", async (t) => {
  const dir = tempDir(t);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${dir}/w.json`, "{nope");
  const r = await tool(dir, "pending_list")({});
  assert.equal(r.isError, true);
  assert.match(r.text!, /not valid JSON/);
});

test("pending_list leaves out another agent's items in the same workspace", async (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", F, new Date());
  addItem(dir, "w", "/c", "B", { ...F, what: "Theirs" }, new Date());
  assert.equal((await tool(dir, "pending_list")({})).text, "a) Pick (about 5 min)");
});

test("pending_update with only a letter says nothing to update", async (t) => {
  const dir = tempDir(t);
  await tool(dir, "pending_add")(F);
  const r = await tool(dir, "pending_update")({ letter: "a" });
  assert.equal(r.isError, true);
  assert.equal(r.text, "Nothing to update.");
});

test("the open hook adds the tools to Claude tabs only once the cutover marker exists", async (t) => {
  const dir = pendingDir({ XDG_STATE_HOME: tempDir(t) });
  const hook = pendingToolsHook(dir);
  const open = (provider: string) => hook({ request: { provider, tools: [] as AgentToolDefinition[] } });
  assert.equal(await open("claude"), undefined);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cutover"), "");
  assert.deepEqual((await open("claude"))?.tools.map((x) => x.name), ["pending_add", "pending_update", "pending_done", "pending_list"]);
  assert.equal(await open("codex"), undefined);
});
