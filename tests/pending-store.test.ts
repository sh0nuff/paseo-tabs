import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  PendingCorrupt, addItem, finishItem, importFiles, listOpen, pendingDir, readPending, reopenItem, setPicked, updateItem, allFiles,
} from "../server/pending-store.ts";
import { tempDir } from "./helpers.ts";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const F = { kind: "waiting" as const, what: "Pick", action: "Choose one", minutes: 5, why: "Blocks work" };
const hours = (h: number) => new Date(NOW.getTime() + h * 3600 * 1000);

test("pendingDir respects XDG_STATE_HOME", () => {
  assert.equal(pendingDir({ XDG_STATE_HOME: "/x", HOME: "/h" }), "/x/paseo-tabs/pending");
  assert.equal(pendingDir({ HOME: "/h" }), "/h/.local/state/paseo-tabs/pending");
});

test("add assigns a, then b, per agent", (t) => {
  const dir = tempDir(t);
  assert.equal(addItem(dir, "w", "/c", "A", F, NOW).letter, "a");
  assert.equal(addItem(dir, "w", "/c", "A", F, NOW).letter, "b");
  assert.equal(addItem(dir, "w", "/c", "B", F, NOW).letter, "a");
});

test("letters are never reused", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", F, NOW);
  addItem(dir, "w", "/c", "A", F, NOW);
  finishItem(dir, "w", "A", "b", "dropped", null, NOW);
  assert.equal(addItem(dir, "w", "/c", "A", F, NOW).letter, "c");
});

test("add refuses a missing field", (t) => {
  const dir = tempDir(t);
  assert.throws(() => addItem(dir, "w", "/c", "A", { ...F, minutes: 0 }, NOW));
  assert.throws(() => addItem(dir, "w", "/c", "A", { ...F, action: "" }, NOW));
  assert.equal(readPending(dir, "w").items.length, 0);
});

test("setPicked keeps one", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", F, NOW);
  addItem(dir, "w", "/c", "A", F, NOW);
  setPicked(dir, "w", "A", "a", NOW);
  setPicked(dir, "w", "A", "b", NOW);
  assert.deepEqual(readPending(dir, "w").items.map((i) => i.picked), [false, true]);
});

test("update, finish and reopen change the item", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", F, NOW);
  assert.equal(updateItem(dir, "w", "A", "a", { what: "New", minutes: 9 }, hours(1)).what, "New");
  const done = finishItem(dir, "w", "A", "a", "done", "ok", hours(2));
  assert.equal(done.status, "done");
  assert.equal(done.note, "ok");
  const back = reopenItem(dir, "w", "A", "a", hours(3));
  assert.equal(back.status, "open");
  assert.equal(back.done, null);
  assert.throws(() => updateItem(dir, "w", "A", "z", {}, NOW));
});

test("concurrent writers lose nothing", async (t) => {
  const dir = tempDir(t);
  const run = () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["tools/pending.ts", "add", "--workspace", "w", "--agent", "A", "--dir", dir, "--json", JSON.stringify(F)], { stdio: "ignore" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    });
  const worker = async () => {
    for (let i = 0; i < 10; i++) await run();
  };
  await Promise.all([worker(), worker()]);
  const letters = readPending(dir, "w").items.map((i) => i.letter).sort();
  assert.deepEqual(letters, [..."abcdefghijklmnopqrst"].sort());
});

test("corrupt file is not overwritten", (t) => {
  const dir = tempDir(t);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "w.json"), "{");
  assert.throws(() => addItem(dir, "w", "/c", "A", F, NOW), PendingCorrupt);
  assert.equal(readFileSync(join(dir, "w.json"), "utf8"), "{");
});

test("listOpen hides done after 24 h", (t) => {
  const dir = tempDir(t);
  for (let i = 0; i < 3; i++) addItem(dir, "w", "/c", "A", F, NOW);
  finishItem(dir, "w", "A", "a", "done", null, hours(-25));
  finishItem(dir, "w", "A", "b", "done", null, hours(-1));
  assert.deepEqual(listOpen(dir, "w", NOW).map((i) => i.letter), ["b", "c"]);
  assert.equal(allFiles(dir).length, 1);
});

test("importFiles merges without validation, and twice adds nothing", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", F, NOW);
  const loose = { ...readPending(dir, "w").items[0], letter: "b", minutes: 0, action: "", why: "" };
  const file = { workspaceId: "w", cwd: "/c", items: [loose], highest: { A: "b", B: "c" } };
  importFiles(dir, [file]);
  importFiles(dir, [file]);
  const got = readPending(dir, "w");
  assert.deepEqual(got.items.map((i) => i.letter), ["a", "b"]);
  assert.deepEqual(got.highest, { A: "b", B: "c" });
  assert.equal(addItem(dir, "w", "/c", "B", F, NOW).letter, "d");
});
