import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  autoArchiveFor,
  hasLegacyHistory,
  modeFor,
  paseoPluginRoot,
  pluginRoot,
  resolveAutoArchive,
  resolveMode,
  savedSettings,
} from "../server/install-state.mjs";
import { controlCli, paseoCliRoot } from "../server/workspace-control.ts";
import { tempDir } from "./helpers.ts";

type T = Parameters<typeof tempDir>[0];

test("resolveMode: the marker forces pending, then the saved mode, then pendingStore, then 1.x history", () => {
  const none = { cutover: false, legacy: false };
  const legacy = { cutover: false, legacy: true };
  const marker = { cutover: true, legacy: true };
  assert.equal(resolveMode({}, none), "pending"); // fresh install
  assert.equal(resolveMode(undefined, none), "pending");
  assert.equal(resolveMode({}, legacy), "tabs-md"); // 1.x install, untouched
  assert.equal(resolveMode({}, marker), "pending"); // 1.x install after cut-over
  assert.equal(resolveMode({ mode: "tabs-md" }, marker), "pending");
  assert.equal(resolveMode({ mode: "tabs-md" }, none), "tabs-md");
  assert.equal(resolveMode({ mode: "pending" }, legacy), "pending");
  assert.equal(resolveMode({ pendingStore: true }, legacy), "pending");
  assert.equal(resolveMode({ pendingStore: false }, none), "pending");
  assert.equal(resolveMode({ mode: "bogus" }, legacy), "tabs-md");
});

test("resolveAutoArchive: off by default, on with the marker, a saved value wins either way", () => {
  assert.equal(resolveAutoArchive({}, { cutover: false }), false);
  assert.equal(resolveAutoArchive({}, { cutover: true }), true);
  assert.equal(resolveAutoArchive({ autoArchive: false }, { cutover: true }), false);
  assert.equal(resolveAutoArchive({ autoArchive: true }, { cutover: false }), true);
});

function store(t: T, { marker = false, clock = false } = {}) {
  const root = tempDir(t);
  const dir = join(root, "paseo-tabs", "pending");
  mkdirSync(dir, { recursive: true });
  if (marker) writeFileSync(join(dir, "cutover"), "");
  if (clock) writeFileSync(join(root, "paseo-tabs", "items-9a863c09.json"), "{}");
  return dir;
}

test("modeFor and autoArchiveFor read the marker and the item clock from disk", (t) => {
  const fresh = store(t);
  assert.equal(hasLegacyHistory(fresh), false);
  assert.equal(modeFor(fresh, {}), "pending");
  assert.equal(autoArchiveFor(fresh, {}), false);
  const legacy = store(t, { clock: true });
  assert.equal(hasLegacyHistory(legacy), true);
  assert.equal(modeFor(legacy, {}), "tabs-md");
  const cut = store(t, { clock: true, marker: true });
  assert.equal(modeFor(cut, {}), "pending");
  assert.equal(autoArchiveFor(cut, {}), true);
  assert.equal(autoArchiveFor(cut, { autoArchive: false }), false);
  // A store folder that does not exist yet is a fresh install.
  assert.equal(modeFor(join(tempDir(t), "nowhere", "pending"), {}), "pending");
});

test("savedSettings reads Paseo's settings file for the plugin, {} when there is none or it is broken", (t) => {
  const home = tempDir(t);
  assert.deepEqual(savedSettings({ PASEO_HOME: home }), {});
  mkdirSync(join(home, "plugin-settings", "paseo-tabs"), { recursive: true });
  writeFileSync(join(home, "plugin-settings", "paseo-tabs", "display.json"), "not json");
  assert.deepEqual(savedSettings({ PASEO_HOME: home }), {});
  writeFileSync(join(home, "plugin-settings", "paseo-tabs", "display.json"), JSON.stringify({ version: 1, values: { mode: "tabs-md", autoArchive: true } }));
  assert.deepEqual(savedSettings({ PASEO_HOME: home }), { mode: "tabs-md", autoArchive: true });
  const cut = store(t, { marker: true });
  assert.equal(modeFor(cut, undefined, { PASEO_HOME: home }), "pending");
  assert.equal(autoArchiveFor(cut, undefined, { PASEO_HOME: home }), true);
});

function pluginFolder(t: T, id = "paseo-tabs"): string {
  const dir = tempDir(t);
  mkdirSync(join(dir, "tools"));
  writeFileSync(join(dir, "tools", "pending.ts"), "");
  writeFileSync(join(dir, "paseo-plugin.json"), JSON.stringify({ id }));
  return dir;
}

test("paseoPluginRoot finds the plugin's folder in Paseo's config.json, by id or by what the folder holds", (t) => {
  const home = tempDir(t);
  assert.equal(paseoPluginRoot({ PASEO_HOME: home }), null);
  const plugin = pluginFolder(t);
  writeFileSync(join(home, "config.json"), JSON.stringify({ plugins: { "paseo-tabs": { source: "directory", path: plugin } } }));
  assert.equal(paseoPluginRoot({ PASEO_HOME: home }), plugin);
  // Installed under another runtime id.
  writeFileSync(join(home, "config.json"), JSON.stringify({ plugins: { other: { path: pluginFolder(t, "other") }, tabs2: { path: plugin } } }));
  assert.equal(paseoPluginRoot({ PASEO_HOME: home }), plugin);
  // A configured folder that is gone is skipped.
  writeFileSync(join(home, "config.json"), JSON.stringify({ plugins: { "paseo-tabs": { path: join(home, "gone") } } }));
  assert.equal(paseoPluginRoot({ PASEO_HOME: home }), null);
});

test("pluginRoot prefers Paseo's folder, then CLAUDE_PLUGIN_ROOT, then the fallback", (t) => {
  const home = tempDir(t);
  const claude = pluginFolder(t);
  assert.equal(pluginRoot({ PASEO_HOME: home }, "/fallback"), "/fallback");
  assert.equal(pluginRoot({ PASEO_HOME: home, CLAUDE_PLUGIN_ROOT: claude }, "/fallback"), claude);
  const paseo = pluginFolder(t);
  writeFileSync(join(home, "config.json"), JSON.stringify({ plugins: { "paseo-tabs": { path: paseo } } }));
  assert.equal(pluginRoot({ PASEO_HOME: home, CLAUDE_PLUGIN_ROOT: claude }, "/fallback"), paseo);
});

test("paseoCliRoot: PASEO_CLI_ROOT, then the paseo command on PATH, then npm root -g", (t) => {
  assert.equal(paseoCliRoot({ PASEO_CLI_ROOT: "/x/cli" }), "/x/cli");
  const root = tempDir(t);
  const cli = join(root, "lib", "node_modules", "@getpaseo", "cli");
  mkdirSync(join(cli, "bin"), { recursive: true });
  writeFileSync(join(cli, "package.json"), JSON.stringify({ name: "@getpaseo/cli" }));
  writeFileSync(join(cli, "bin", "paseo"), "#!/bin/sh\n");
  chmodSync(join(cli, "bin", "paseo"), 0o755);
  mkdirSync(join(root, "bin"));
  symlinkSync(join(cli, "bin", "paseo"), join(root, "bin", "paseo"));
  assert.equal(paseoCliRoot({ PATH: join(root, "bin") }, () => null), cli);
  assert.equal(paseoCliRoot({ PATH: join(root, "empty") }, () => "/usr/lib/node_modules"), "/usr/lib/node_modules/@getpaseo/cli");
  assert.throws(() => paseoCliRoot({ PATH: join(root, "empty") }, () => null), /PASEO_CLI_ROOT/);
});

test("controlCli uses its own folder, else the folder Paseo's config names", (t) => {
  const here = pathToFileURL("/opt/tabs/server/workspace-control.ts").href;
  assert.equal(controlCli({}, here), "/opt/tabs/tools/workspace-control.ts");
  const home = tempDir(t);
  const plugin = pluginFolder(t);
  writeFileSync(join(home, "config.json"), JSON.stringify({ plugins: { "paseo-tabs": { path: plugin } } }));
  assert.equal(controlCli({ PASEO_HOME: home }, null), join(plugin, "tools", "workspace-control.ts"));
  assert.throws(() => controlCli({ PASEO_HOME: tempDir(t) }, null), /PASEO_TABS_CONTROL/);
});
