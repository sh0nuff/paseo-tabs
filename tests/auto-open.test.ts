import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { claimOpen, shouldAskToOpen } from "../shared/auto-open.ts";
import { panelOpenClaimHandler } from "../server/auto-open.ts";
import { maybeOpenPanel, resetAsked, setPanelOpener } from "../client/auto-open.ts";
import { tempDir } from "./helpers.ts";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

test("shouldAskToOpen: only workspaces created in the last 10 minutes", () => {
  const base = { autoOpenPanel: true, now: NOW, alreadyAsked: false };
  assert.equal(shouldAskToOpen({ ...base, createdAt: ago(2) }), true);
  assert.equal(shouldAskToOpen({ ...base, createdAt: ago(10) }), true);
  assert.equal(shouldAskToOpen({ ...base, createdAt: ago(11) }), false);
  assert.equal(shouldAskToOpen({ ...base, createdAt: null }), false);
  assert.equal(shouldAskToOpen({ ...base, createdAt: "garbage" }), false);
  assert.equal(shouldAskToOpen({ ...base, createdAt: ago(2), alreadyAsked: true }), false);
});

test("shouldAskToOpen: the setting defaults on and off stops it", () => {
  assert.equal(shouldAskToOpen({ autoOpenPanel: undefined, createdAt: ago(1), now: NOW, alreadyAsked: false }), true);
  assert.equal(shouldAskToOpen({ autoOpenPanel: false, createdAt: ago(1), now: NOW, alreadyAsked: false }), false);
});

test("claimOpen: first call claims, second does not, old records are pruned", () => {
  const a = claimOpen({}, "w1", NOW);
  assert.equal(a.claimed, true);
  assert.equal(claimOpen(a.record, "w1", NOW).claimed, false);
  const later = new Date(NOW.getTime() + 31 * 24 * 3600 * 1000);
  const b = claimOpen(a.record, "w1", later);
  assert.equal(b.claimed, true);
});

test("handler: once per workspace, nothing recorded when the panel is off", (t) => {
  const path = join(tempDir(t), "state", "panel-opened.json");
  assert.deepEqual(panelOpenClaimHandler(path, "w1", false, NOW), { claimed: false });
  assert.equal(existsSync(path), false);
  assert.deepEqual(panelOpenClaimHandler(path, "w1", true, NOW), { claimed: true });
  assert.deepEqual(panelOpenClaimHandler(path, "w1", true, NOW), { claimed: false });
  assert.deepEqual(panelOpenClaimHandler(path, "w2", true, NOW), { claimed: true });
});

test("client: opens once for a new workspace, not again on re-render or when claimed elsewhere", async (t) => {
  resetAsked();
  const opened: string[] = [];
  setPanelOpener((id) => opened.push(id));
  t.after(() => setPanelOpener(null));
  let calls = 0;
  const claim = async () => ({ claimed: ++calls === 1 });
  const input = { workspaceId: "w1", createdAt: ago(1), autoOpenPanel: true, now: NOW, claim };
  assert.equal(await maybeOpenPanel(input), true);
  assert.equal(await maybeOpenPanel(input), false);
  assert.equal(calls, 1);
  assert.deepEqual(opened, ["w1"]);
  // another device already opened it
  assert.equal(await maybeOpenPanel({ ...input, workspaceId: "w2", claim: async () => ({ claimed: false }) }), false);
  assert.equal(await maybeOpenPanel({ ...input, workspaceId: "w3", autoOpenPanel: false }), false);
  assert.equal(await maybeOpenPanel({ ...input, workspaceId: "w4", createdAt: ago(30) }), false);
  assert.deepEqual(opened, ["w1"]);
});
