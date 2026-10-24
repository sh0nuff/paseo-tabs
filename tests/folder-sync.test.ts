import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRecord, PaseoState } from "../server/paseo-state.ts";
import { type FileIO, syncFolder } from "../server/folder-sync.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const NEW = "No items yet. This tab hasn't written to this file.";

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "folder-sync-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gitInit(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

function agent(id: string, cwd: string, fields: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    title: "A title",
    cwd,
    workspaceId: "wks_1111111aaaaaaa",
    provider: "claude",
    createdAt: "2026-10-24T09:00:00.000Z",
    archivedAt: null,
    ...fields,
  };
}

function state(...agents: AgentRecord[]): PaseoState {
  return { agents, workspaces: [] };
}

function excludeLines(repo: string): string[] {
  const path = join(repo, ".git", "info", "exclude");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l === "TABS.md") : [];
}

test("creates TABS.md and one exclude line in a git folder with an open Claude tab", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  assert.equal(syncFolder(repo, state(agent("aaaaaaa1", repo)), NOW), "created");

  assert.equal(readFileSync(join(repo, "TABS.md"), "utf8"), `## 1. A title · aaaaaaa\n\n${NEW}\n`);
  assert.deepEqual(excludeLines(repo), ["TABS.md"]);
});

test("a second run is unchanged and adds no exclude line", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const s = state(agent("aaaaaaa1", repo));
  syncFolder(repo, s, NOW);

  assert.equal(syncFolder(repo, s, NOW), "unchanged");
  assert.deepEqual(excludeLines(repo), ["TABS.md"]);
});

test("ignores agents from other folders", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  syncFolder(repo, state(agent("aaaaaaa1", repo), agent("bbbbbbb2", "/elsewhere")), NOW);

  assert.doesNotMatch(readFileSync(join(repo, "TABS.md"), "utf8"), /bbbbbbb/);
});

test("skips a folder whose only open tab is not Claude", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  assert.equal(syncFolder(repo, state(agent("aaaaaaa1", repo, { provider: "codex" })), NOW), "skipped");
  assert.equal(existsSync(join(repo, "TABS.md")), false);
});

test("skips a folder with only closed tabs", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const closed = agent("aaaaaaa1", repo, { archivedAt: "2026-10-24T11:00:00.000Z" });

  assert.equal(syncFolder(repo, state(closed), NOW), "skipped");
  assert.equal(existsSync(join(repo, "TABS.md")), false);
});

test("skips a folder that isn't a git repo", (t) => {
  const dir = join(tempDir(t), "plain");
  mkdirSync(dir);

  assert.equal(syncFolder(dir, state(agent("aaaaaaa1", dir)), NOW), "skipped");
  assert.equal(existsSync(join(dir, "TABS.md")), false);
  assert.equal(existsSync(join(dir, ".git")), false);
});

test("skips a subfolder of a git repo", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const sub = join(repo, "sub");
  mkdirSync(sub);

  assert.equal(syncFolder(sub, state(agent("aaaaaaa1", sub)), NOW), "skipped");
  assert.equal(existsSync(join(sub, "TABS.md")), false);
});

test("skips a missing folder", (t) => {
  const gone = join(tempDir(t), "gone");

  assert.equal(syncFolder(gone, state(agent("aaaaaaa1", gone)), NOW), "skipped");
});

test("puts the exclude line in the main repo for a worktree", (t) => {
  const root = tempDir(t);
  const main = gitInit(join(root, "main"));
  execFileSync("git", ["-C", main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]);
  const tree = join(root, "tree");
  execFileSync("git", ["-C", main, "worktree", "add", "-q", tree, "-b", "tree"]);

  assert.equal(syncFolder(tree, state(agent("aaaaaaa1", tree)), NOW), "created");

  assert.deepEqual(excludeLines(main), ["TABS.md"]);
  const status = execFileSync("git", ["-C", tree, "status", "--porcelain"], { encoding: "utf8" });
  assert.equal(status, "");
});

test("updates an existing file even with no open Claude tab", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  writeFileSync(join(repo, "TABS.md"), "## 1. A title · aaaaaaa\n\n- a) [ ] item\n");
  const closed = agent("aaaaaaa1", repo, { archivedAt: "2026-10-24T11:00:00.000Z" });

  assert.equal(syncFolder(repo, state(closed), NOW), "updated");

  assert.equal(readFileSync(join(repo, "TABS.md"), "utf8"), "## 1. A title · aaaaaaa · closed\n\n- a) [ ] item\n");
  assert.deepEqual(excludeLines(repo), []);
});

test("syncFolder re-reads before writing", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const before = "## 7. Old · aaaaaaa\n\n- a) [ ] item\n";
  const edited = "## 7. Old · aaaaaaa\n\n- a) [ ] item\n- b) [ ] new line from the tab\n";
  const reads = [before, edited];
  let written: string | null = null;
  const io: FileIO = {
    read: () => (reads.length > 1 ? reads.shift()! : reads[0]),
    write: (_path, text) => {
      written = text;
    },
  };

  assert.equal(syncFolder(repo, state(agent("aaaaaaa1", repo)), NOW, io), "updated");

  assert.equal(written, "## 1. A title · aaaaaaa\n\n- a) [ ] item\n- b) [ ] new line from the tab\n");
});

test("writes nothing while a tab keeps changing the file", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  let n = 0;
  let written = false;
  const io: FileIO = {
    read: () => `## 1. Old · aaaaaaa\n\n- a) [ ] edit ${n++}\n`,
    write: () => {
      written = true;
    },
  };

  assert.equal(syncFolder(repo, state(agent("aaaaaaa1", repo)), NOW, io), "busy");
  assert.equal(written, false);
});
