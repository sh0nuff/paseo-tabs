import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertPluginCompatibility } from "@getpaseo/protocol/plugin-requirements";

const manifest = JSON.parse(readFileSync(new URL("../paseo-plugin.json", import.meta.url), "utf8"));

// The Paseo app runs this same check before it loads a plugin's panel and
// commands, and skips the plugin quietly when it fails. Paseo 0.11.0 to 0.11.2
// ship the same plugin API, so all of them must be let in.
test("the manifest lets Paseo apps from 0.11.0 load the plugin", () => {
  for (const version of ["0.11.0", "0.11.1", "0.11.2", "0.11.4"]) {
    assert.doesNotThrow(
      () => assertPluginCompatibility({ id: manifest.id, requirements: manifest.requirements, version, runtime: "app" }),
      `Paseo ${version} should load the plugin`,
    );
  }
});

test("the manifest keeps out apps older than 0.11.0", () => {
  assert.throws(() =>
    assertPluginCompatibility({ id: manifest.id, requirements: manifest.requirements, version: "0.10.9", runtime: "app" }),
  );
});
