import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, paseoHome, stateFingerprint } from "../server/paseo-state.ts";

function makeHome(t: { after: (fn: () => void) => void }): string {
  const home = mkdtempSync(join(tmpdir(), "paseo-state-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "agents", "home-x-repo"), { recursive: true });
  mkdirSync(join(home, "projects"), { recursive: true });
  return home;
}

function writeAgent(home: string, name: string, body: unknown): string {
  const path = join(home, "agents", "home-x-repo", `${name}.json`);
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  return path;
}

const A1 = {
  id: "a1aaaaaa-0000",
  provider: "claude",
  cwd: "/repo",
  workspaceId: "wks_1111111aaaaaaa",
  createdAt: "2026-10-24T10:00:00.000Z",
  title: "First tab",
  lastStatus: "idle",
};

test("paseoHome prefers PASEO_HOME", () => {
  assert.equal(paseoHome({ PASEO_HOME: "/x", HOME: "/h" }), "/x");
  assert.equal(paseoHome({ HOME: "/h" }), "/h/.paseo");
});

test("loadState reads agents and workspaces", (t) => {
  const home = makeHome(t);
  writeAgent(home, "a1", { ...A1, archivedAt: "2026-10-24T11:00:00.000Z" });
  writeFileSync(
    join(home, "projects", "workspaces.json"),
    JSON.stringify([
      { workspaceId: "wks_1111111aaaaaaa", cwd: "/repo", title: "Repo work", archivedAt: null },
    ]),
  );

  const state = loadState(home);

  assert.deepEqual(state.agents, [
    {
      id: "a1aaaaaa-0000",
      title: "First tab",
      cwd: "/repo",
      workspaceId: "wks_1111111aaaaaaa",
      provider: "claude",
      createdAt: "2026-10-24T10:00:00.000Z",
      archivedAt: "2026-10-24T11:00:00.000Z",
    },
  ]);
  assert.deepEqual(state.workspaces, [
    { id: "wks_1111111aaaaaaa", cwd: "/repo", title: "Repo work", archivedAt: null },
  ]);
});

test("loadState fills missing optional fields with null", (t) => {
  const home = makeHome(t);
  writeAgent(home, "a1", { id: "a1", cwd: "/repo", provider: "codex", createdAt: "2026-10-24T10:00:00.000Z" });

  const [agent] = loadState(home).agents;

  assert.equal(agent.title, null);
  assert.equal(agent.workspaceId, null);
  assert.equal(agent.archivedAt, null);
});

test("loadState skips unreadable agent files", (t) => {
  const home = makeHome(t);
  writeAgent(home, "a1", A1);
  writeAgent(home, "a2", '{"id": "a2", "ti');
  writeAgent(home, "a3", { ...A1, id: "a3", internal: true });
  writeAgent(home, "a4", { ...A1, id: "a4", cwd: undefined });

  assert.deepEqual(
    loadState(home).agents.map((a) => a.id),
    ["a1aaaaaa-0000"],
  );
});

test("loadState returns no workspaces when workspaces.json is missing", (t) => {
  const home = makeHome(t);
  assert.deepEqual(loadState(home).workspaces, []);
});

test("stateFingerprint changes when an agent file changes", (t) => {
  const home = makeHome(t);
  const path = writeAgent(home, "a1", A1);
  utimesSync(path, new Date("2026-10-24T10:00:00Z"), new Date("2026-10-24T10:00:00Z"));
  const before = stateFingerprint(home);

  utimesSync(path, new Date("2026-10-24T10:00:05Z"), new Date("2026-10-24T10:00:05Z"));

  assert.notEqual(stateFingerprint(home), before);
});

test("stateFingerprint changes when workspaces.json changes", (t) => {
  const home = makeHome(t);
  writeAgent(home, "a1", A1);
  const before = stateFingerprint(home);

  writeFileSync(join(home, "projects", "workspaces.json"), "[]");

  assert.notEqual(stateFingerprint(home), before);
});
