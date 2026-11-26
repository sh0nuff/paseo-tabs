import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readPending } from "../server/pending-store.ts";
import { makeHome, tempDir, writeAgent, writeWorkspaces } from "./helpers.ts";

const TOOL = fileURLToPath(new URL("../tools/pending.ts", import.meta.url));
const F = { kind: "waiting", what: "Pick", action: "Choose one", minutes: 5, why: "Blocks work" };

function setup(t: { after: (fn: () => void) => void }) {
  const root = tempDir(t);
  const home = makeHome(root);
  const dir = join(root, "store");
  writeWorkspaces(home, [{ workspaceId: "wks_1111111aaaaaaa", cwd: "/work/one", title: "One" }]);
  writeAgent(home, { id: "aaaaaaa1-full", cwd: "/work/one/sub", workspaceId: "wks_1111111aaaaaaa" });
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [TOOL, ...args, "--dir", dir, "--home", home], { encoding: "utf8" });
  return { home, dir, run };
}

test("without --workspace, the agent's workspace and its folder come from Paseo", (t) => {
  const { dir, run } = setup(t);
  const item = JSON.parse(run("add", "--agent", "aaaaaaa1-full", "--json", JSON.stringify(F)));
  assert.equal(item.letter, "a");
  const file = readPending(dir, "wks_1111111aaaaaaa");
  assert.equal(file.cwd, "/work/one");
  assert.equal(file.items.length, 1);
  assert.equal(JSON.parse(run("list", "--agent", "aaaaaaa1-full")).length, 1);
  run("done", "--agent", "aaaaaaa1-full", "--letter", "a", "--note", "fine");
  assert.equal(readPending(dir, "wks_1111111aaaaaaa").items[0].status, "done");
});

test("an explicit --workspace and --cwd still win", (t) => {
  const { dir, run } = setup(t);
  run("add", "--workspace", "wks_other", "--agent", "aaaaaaa1-full", "--cwd", "/x", "--json", JSON.stringify(F));
  assert.equal(readPending(dir, "wks_other").cwd, "/x");
  assert.equal(readPending(dir, "wks_1111111aaaaaaa").items.length, 0);
});

test("an agent Paseo doesn't know is an error that names --workspace", (t) => {
  const { home, dir } = setup(t);
  const r = spawnSync(process.execPath, [TOOL, "list", "--agent", "nobody", "--dir", dir, "--home", home], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no workspace for agent nobody; pass --workspace/);
});

test("no arguments prints the usage", () => {
  const r = spawnSync(process.execPath, [TOOL], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^usage: pending\.ts <add\|update\|done\|drop\|reopen\|list> --agent <id>/);
});
