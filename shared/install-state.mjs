// Where this install keeps its state, and which mode and settings are in force.
//
// Plain JavaScript with node built-ins only, so the daemon (bundled), the Claude Code
// hooks (plain node) and the command-line tools all read the same answer.
//
// Mode:
//   - The cut-over marker (<pendingDir>/cutover, written by a 1.x migration) forces "pending".
//   - Otherwise a saved `mode` setting wins.
//   - Otherwise the old `pendingStore` switch, when it was turned on, means "pending".
//   - Otherwise an install with 1.x history (an item clock, items-*.json, beside the store)
//     keeps "tabs-md", so an upgrade changes nothing until the user switches.
//   - Otherwise (a fresh install) "pending".
//
// Auto-archive: a saved `autoArchive` setting wins; otherwise it is on only when the
// cut-over marker exists, so installs migrated from 1.x keep archiving as before.

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PLUGIN_ID = "paseo-tabs";
export const SETTINGS_ID = "display";

/** $XDG_STATE_HOME, else ~/.local/state. */
export function stateRoot(env = process.env) {
  return env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
}

/** The plugin's own state folder. */
export function tabsStateDir(env = process.env) {
  return join(stateRoot(env), "paseo-tabs");
}

/** The pending store: one JSON file per workspace. */
export function pendingStoreDir(env = process.env) {
  return join(tabsStateDir(env), "pending");
}

/** Paseo's home folder: $PASEO_HOME, else ~/.paseo. */
export function paseoHomeDir(env = process.env) {
  return env.PASEO_HOME || join(env.HOME || homedir(), ".paseo");
}

export function cutoverPath(dir) {
  return join(dir, "cutover");
}

export function hasCutover(dir) {
  try {
    return existsSync(cutoverPath(dir));
  } catch {
    return false;
  }
}

/** True when a 1.x item clock (items-<hash>.json) sits beside the store folder. */
export function hasLegacyHistory(dir) {
  try {
    return readdirSync(dirname(dir)).some((name) => /^items-[0-9a-f]+\.json$/.test(name));
  } catch {
    return false;
  }
}

/** The settings saved in Paseo for this plugin, or {} when none were saved or the file is unreadable. */
export function savedSettings(env = process.env) {
  try {
    const raw = JSON.parse(readFileSync(join(paseoHomeDir(env), "plugin-settings", PLUGIN_ID, `${SETTINGS_ID}.json`), "utf8"));
    return raw && typeof raw.values === "object" && raw.values !== null ? raw.values : {};
  } catch {
    return {};
  }
}

/** "pending" or "tabs-md". `saved` holds the saved settings; `facts` what is on disk. */
export function resolveMode(saved, { cutover, legacy }) {
  if (cutover) return "pending";
  if (saved && (saved.mode === "pending" || saved.mode === "tabs-md")) return saved.mode;
  if (saved && saved.pendingStore === true) return "pending";
  return legacy ? "tabs-md" : "pending";
}

export function resolveAutoArchive(saved, { cutover }) {
  if (saved && typeof saved.autoArchive === "boolean") return saved.autoArchive;
  return cutover;
}

/** The mode in force for the store folder `dir`, with `saved` settings (read from disk when omitted). */
export function modeFor(dir, saved, env = process.env) {
  return resolveMode(saved ?? savedSettings(env), { cutover: hasCutover(dir), legacy: hasLegacyHistory(dir) });
}

export function autoArchiveFor(dir, saved, env = process.env) {
  return resolveAutoArchive(saved ?? savedSettings(env), { cutover: hasCutover(dir) });
}

function isPluginRoot(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "paseo-plugin.json"), "utf8")).id === PLUGIN_ID && existsSync(join(dir, "tools", "pending.ts"));
  } catch {
    return false;
  }
}

/**
 * The folder Paseo runs this plugin from, read from Paseo's config.json: the entry with this
 * plugin's id, else any entry whose folder holds this plugin. null when Paseo has none.
 */
export function paseoPluginRoot(env = process.env) {
  let plugins;
  try {
    plugins = JSON.parse(readFileSync(join(paseoHomeDir(env), "config.json"), "utf8")).plugins;
  } catch {
    return null;
  }
  if (!plugins || typeof plugins !== "object") return null;
  const entries = [plugins[PLUGIN_ID], ...Object.values(plugins)];
  for (const entry of entries) {
    const path = entry && typeof entry.path === "string" ? entry.path : null;
    if (path && isPluginRoot(path)) {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    }
  }
  return null;
}

/**
 * The plugin folder whose tools/pending.ts tabs should run: Paseo's install first (it is the
 * copy the daemon runs), then $CLAUDE_PLUGIN_ROOT, then `fallback`.
 */
export function pluginRoot(env = process.env, fallback = null) {
  const paseo = paseoPluginRoot(env);
  if (paseo) return paseo;
  if (env.CLAUDE_PLUGIN_ROOT && isPluginRoot(env.CLAUDE_PLUGIN_ROOT)) return env.CLAUDE_PLUGIN_ROOT;
  return fallback;
}
