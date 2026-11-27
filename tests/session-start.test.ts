import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gitInit, tempDir } from "./helpers.ts";

const HOOK = fileURLToPath(new URL("../claude/session-start.mjs", import.meta.url));

function run(env: Record<string, string>, input = "", hook = HOOK) {
  const result = spawnSync(process.execPath, [hook], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", XDG_STATE_HOME: "/nonexistent-state", PASEO_HOME: "/nonexistent-paseo-home", ...env },
    input,
    encoding: "utf8",
    timeout: 5000,
  });
  return { stdout: result.stdout, status: result.status };
}

/** A state folder with 1.x history (an item clock), so the hook picks mode tabs-md. */
function legacyState(t: Parameters<typeof tempDir>[0]): string {
  const state = tempDir(t);
  mkdirSync(join(state, "paseo-tabs"), { recursive: true });
  writeFileSync(join(state, "paseo-tabs", "items-0123abcd.json"), "{}");
  return state;
}

function context(stdout: string): string {
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  return parsed.hookSpecificOutput.additionalContext;
}

test("prints nothing outside Paseo", () => {
  assert.deepEqual(run({}), { stdout: "", status: 0 });
});

test("prints nothing outside a git repo", (t) => {
  const dir = join(tempDir(t), "plain");
  mkdirSync(dir);
  assert.deepEqual(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: dir }), { stdout: "", status: 0 });
});

test("prints nothing in a subfolder of a git repo", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const sub = join(repo, "sub");
  mkdirSync(sub);
  assert.deepEqual(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: sub }), { stdout: "", status: 0 });
});

test("a 1.x install gets the TABS.md rule with the short id and TABS.md path in a git repo", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const { stdout, status } = run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: legacyState(t) });

  assert.equal(status, 0);
  const rule = context(stdout);
  assert.match(rule, /· abcdef1`/);
  assert.ok(rule.includes(`${repo}/TABS.md`));
  assert.doesNotMatch(rule, /\{\{/);
});

test("falls back to the hook input's cwd", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const { stdout } = run({ PASEO_AGENT_ID: "abcdef1234", XDG_STATE_HOME: legacyState(t) }, JSON.stringify({ cwd: repo, source: "resume" }));

  assert.ok(context(stdout).includes(`${repo}/TABS.md`));
});

test("exits 0 even when rule.md is missing", (t) => {
  const root = tempDir(t);
  const repo = gitInit(join(root, "repo"));
  mkdirSync(join(root, "plugin"));
  const lonely = join(root, "plugin", "session-start.mjs");
  copyFileSync(HOOK, lonely);

  assert.deepEqual(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo }, "", lonely), { stdout: "", status: 0 });
});

test("gives the tab its full agent ID for renaming itself", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo }).stdout);

  assert.match(rule, /update_agent/);
  assert.match(rule, /`abcdef1234-5678`/);
});

test("the TABS.md rule asks a tab to finish before saying it can be closed", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: legacyState(t) }).stdout);

  assert.ok(rule.includes("Closing a tab gives it no turn"), "the rule should say closing gives no turn");
  assert.ok(rule.includes("a day after they are ticked"), "the rule should say when finished items leave");
});

test("the rule asks each waiting item to say how long the user's part takes", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));

  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo }).stdout);

  assert.ok(rule.includes("(about N min)"), "the rule should ask for (about N min) on waiting items");
});

test("with the cutover marker, prints the pending rule with the ids filled", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const state = tempDir(t);
  mkdirSync(join(state, "paseo-tabs", "pending"), { recursive: true });
  writeFileSync(join(state, "paseo-tabs", "pending", "cutover"), "");

  const rule = context(
    run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: state }).stdout,
  );

  assert.match(rule, /pending_add/);
  assert.match(rule, /Picked from the panel:/);
  assert.match(rule, /A message starting `Done from the panel:` means the user has finished that item\./);
  assert.match(rule, /keep it open\./);
  assert.match(rule, /`abcdef1234-5678`/);
  assert.doesNotMatch(rule, /TABS\.md/);
  assert.doesNotMatch(rule, /\{\{/);
});

test("the marker is found under HOME/.local/state when XDG_STATE_HOME is unset", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const home = tempDir(t);
  mkdirSync(join(home, ".local", "state", "paseo-tabs", "pending"), { recursive: true });
  writeFileSync(join(home, ".local", "state", "paseo-tabs", "pending", "cutover"), "");

  const result = spawnSync(process.execPath, [HOOK], {
    env: { PATH: process.env.PATH ?? "", HOME: home, PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo },
    encoding: "utf8",
    timeout: 5000,
  });

  assert.match(context(result.stdout), /pending_add/);
});

test("a 1.x install without the marker prints the TABS.md rule", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const state = legacyState(t);
  mkdirSync(join(state, "paseo-tabs", "pending"), { recursive: true });

  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: state }).stdout);

  assert.ok(rule.includes(`${repo}/TABS.md`));
  assert.doesNotMatch(rule, /pending_add/);
});

test("with the marker but no pending rule file, still exits 0 and prints nothing", (t) => {
  const root = tempDir(t);
  const repo = gitInit(join(root, "repo"));
  const state = join(root, "state");
  mkdirSync(join(state, "paseo-tabs", "pending"), { recursive: true });
  writeFileSync(join(state, "paseo-tabs", "pending", "cutover"), "");
  mkdirSync(join(root, "plugin"));
  copyFileSync(HOOK, join(root, "plugin", "session-start.mjs"));
  copyFileSync(join(dirname(HOOK), "rule.md"), join(root, "plugin", "rule.md"));

  assert.deepEqual(
    run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: state }, "", join(root, "plugin", "session-start.mjs")),
    { stdout: "", status: 0 },
  );
});

// 2.0: mode, auto-archive and the plugin folder.

test("a fresh install gets the pending rule, with no archiving and the hook's own plugin folder", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: tempDir(t) }).stdout);
  assert.match(rule, /pending_add/);
  assert.match(rule, /end your reply with the line "Nothing further waiting on you\."$/m);
  assert.doesNotMatch(rule, /archived by itself/);
  assert.doesNotMatch(rule, /stays archived unless/);
  const root = dirname(dirname(HOOK));
  assert.ok(rule.includes(`node ${root}/tools/pending.ts add --agent`), "the plugin folder should be filled in");
  assert.doesNotMatch(rule, /\{\{/);
});

test("with the cutover marker, the rule says the workspace archives itself", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const state = tempDir(t);
  mkdirSync(join(state, "paseo-tabs", "pending"), { recursive: true });
  writeFileSync(join(state, "paseo-tabs", "pending", "cutover"), "");
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234-5678", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: state }).stdout);
  assert.match(rule, /archived by itself about 10 minutes later/);
  assert.match(rule, /Its workspace stays archived unless you add an item waiting on the user\./);
});

/** A Paseo home whose saved plugin settings are `values`, and optionally a config naming the plugin's folder. */
function paseoHome(t: Parameters<typeof tempDir>[0], values: Record<string, unknown> | null, pluginPath?: string): string {
  const home = tempDir(t);
  if (values) {
    mkdirSync(join(home, "plugin-settings", "paseo-tabs"), { recursive: true });
    writeFileSync(join(home, "plugin-settings", "paseo-tabs", "display.json"), JSON.stringify({ version: 1, values }));
  }
  if (pluginPath) writeFileSync(join(home, "config.json"), JSON.stringify({ plugins: { "paseo-tabs": { source: "directory", path: pluginPath, enabled: true } } }));
  return home;
}

test("a saved autoArchive false wins over the cutover marker", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const state = tempDir(t);
  mkdirSync(join(state, "paseo-tabs", "pending"), { recursive: true });
  writeFileSync(join(state, "paseo-tabs", "pending", "cutover"), "");
  const home = paseoHome(t, { autoArchive: false });
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: state, PASEO_HOME: home }).stdout);
  assert.match(rule, /pending_add/);
  assert.doesNotMatch(rule, /archived by itself/);
});

test("a saved autoArchive true turns the archive wording on for a fresh install", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const home = paseoHome(t, { autoArchive: true });
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: tempDir(t), PASEO_HOME: home }).stdout);
  assert.match(rule, /archived by itself/);
});

test("a saved mode tabs-md gives a fresh install the TABS.md rule; a saved mode pending gives a 1.x install the pending rule", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const tabs = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: tempDir(t), PASEO_HOME: paseoHome(t, { mode: "tabs-md" }) }).stdout);
  assert.ok(tabs.includes(`${repo}/TABS.md`));
  const pending = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: legacyState(t), PASEO_HOME: paseoHome(t, { mode: "pending" }) }).stdout);
  assert.match(pending, /pending_add/);
});

test("the plugin folder Paseo runs is used when its config names one", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const plugin = tempDir(t);
  mkdirSync(join(plugin, "tools"));
  writeFileSync(join(plugin, "tools", "pending.ts"), "");
  writeFileSync(join(plugin, "paseo-plugin.json"), JSON.stringify({ id: "paseo-tabs" }));
  const home = paseoHome(t, null, plugin);
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: tempDir(t), PASEO_HOME: home }).stdout);
  assert.ok(rule.includes(`node ${plugin}/tools/pending.ts add`));
});

test("CLAUDE_PLUGIN_ROOT is used when Paseo names no folder", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const plugin = tempDir(t);
  mkdirSync(join(plugin, "tools"));
  writeFileSync(join(plugin, "tools", "pending.ts"), "");
  writeFileSync(join(plugin, "paseo-plugin.json"), JSON.stringify({ id: "paseo-tabs" }));
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: tempDir(t), CLAUDE_PLUGIN_ROOT: plugin }).stdout);
  assert.ok(rule.includes(`node ${plugin}/tools/pending.ts add`));
});

test("rule-extra.md in the state folder is appended to the rule", (t) => {
  const repo = gitInit(join(tempDir(t), "repo"));
  const state = tempDir(t);
  mkdirSync(join(state, "paseo-tabs"), { recursive: true });
  writeFileSync(join(state, "paseo-tabs", "rule-extra.md"), "Also mirror waiting items to the team board.\n");
  const rule = context(run({ PASEO_AGENT_ID: "abcdef1234", PASEO_AGENT_CWD: repo, XDG_STATE_HOME: state }).stdout);
  assert.match(rule, /pending_add/);
  assert.match(rule, /\n\nAlso mirror waiting items to the team board\.\n$/);
});
