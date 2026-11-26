import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem } from "../server/pending-store.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pendingEnabledHandler, pendingListHandler, pendingPickHandler, pendingSearchHandler, pendingUnpickHandler, pickMessage } from "../server/pending-rpc.ts";
import { makeHome, tempDir, writeWorkspaces } from "./helpers.ts";

const T0 = new Date("2026-11-26T12:00:00.000Z");
const later = (m: number) => new Date(T0.getTime() + m * 60000);
const W = { kind: "waiting" as const, what: "Install the Jellyfin app on the TV", action: "Open Play Store on the TV, search Jellyfin, sign in", minutes: 5, why: "The TV can't play the new library without it" };

test("pickMessage uses the exact format and fallbacks", () => {
  const card = { agentId: "A", letter: "c", what: W.what, action: W.action, minutes: 5, why: W.why, picked: false, status: "open" as const };
  assert.equal(
    pickMessage(card),
    "Picked from the panel: Install the Jellyfin app on the TV. Action: Open Play Store on the TV, search Jellyfin, sign in. About 5 min. Why: The TV can't play the new library without it. (item c)",
  );
  assert.match(pickMessage({ ...card, action: "", why: "" }), /Action: ask the tab\. About 5 min\. Why: not given\. \(item c\)$/);
});

test("list omits next items, orders oldest first, spans tabs", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "B", { ...W, what: "second" }, later(10));
  addItem(dir, "w", "/c", "A", { ...W, what: "first" }, later(0));
  addItem(dir, "w", "/c", "A", { ...W, kind: "next", what: "later" }, later(5));
  assert.deepEqual(pendingListHandler(dir, "w").items.map((i) => i.what), ["first", "second"]);
});

test("a second pick clears the first and a closed item cannot be picked", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", W, T0);
  addItem(dir, "w", "/c", "A", W, T0);
  assert.match(pendingPickHandler(dir, "w", "A", "a", T0).message, /\(item a\)$/);
  pendingPickHandler(dir, "w", "A", "b", later(1));
  assert.deepEqual(pendingListHandler(dir, "w").items.map((i) => i.picked), [false, true]);
  assert.throws(() => pendingPickHandler(dir, "w", "A", "z", T0), /No item/);
});

test("search finds items across workspaces with names, blank query finds none", (t) => {
  const dir = tempDir(t);
  const home = makeHome(tempDir(t));
  writeWorkspaces(home, [{ workspaceId: "wks_1", cwd: "/x", title: "Media" }]);
  addItem(dir, "wks_1", "/x", "A", W, T0);
  addItem(dir, "wks_2", "/y", "A", { ...W, what: "Other", action: "x", why: "y" }, T0);
  const { hits } = pendingSearchHandler(dir, home, "JELLYFIN");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].workspaceName, "Media");
  assert.equal(pendingSearchHandler(dir, home, "other").hits[0].workspaceName, "wks_2");
  assert.deepEqual(pendingSearchHandler(dir, home, "  ").hits, []);
});

test("a second pick of the same item is refused until unpick clears it", (t) => {
  const dir = tempDir(t);
  addItem(dir, "w", "/c", "A", W, T0);
  pendingPickHandler(dir, "w", "A", "a", T0);
  assert.throws(() => pendingPickHandler(dir, "w", "A", "a", T0), /already picked/);
  assert.deepEqual(pendingUnpickHandler(dir, "w", "A", "a"), { ok: true });
  assert.deepEqual(pendingListHandler(dir, "w").items.map((i) => i.picked), [false]);
  assert.match(pendingPickHandler(dir, "w", "A", "a", T0).message, /\(item a\)$/);
});

test("pending.enabled follows the cutover marker", (t) => {
  const dir = join(tempDir(t), "pending");
  assert.deepEqual(pendingEnabledHandler(dir), { enabled: false });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cutover"), "");
  assert.deepEqual(pendingEnabledHandler(dir), { enabled: true });
});
