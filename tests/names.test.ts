import { test } from "node:test";
import assert from "node:assert/strict";
import { shortenName } from "../server/names.ts";

test("keeps a name that already fits", () => {
  assert.equal(shortenName("Ring listings R1519-R1521", 40), "Ring listings R1519-R1521");
  assert.equal(shortenName(`Quotes "kept" when short`, 40), `Quotes "kept" when short`);
});

test("drops stray quotes and backticks and keeps the first clause", () => {
  assert.equal(
    shortenName('"Make `proj new` work on assetdev. The `gh` token is being g', 40),
    "Make proj new work on assetdev",
  );
  assert.equal(
    shortenName('I don\'t see my "TAB.md" repo on git, is it still not added?', 40),
    "I don't see my TAB.md repo on git",
  );
});

test("drops an opener and cuts at a word with an ellipsis", () => {
  assert.equal(
    shortenName("I need to re-add assetdev to my phone's paseo since we moved", 40),
    "Re-add assetdev to my phone's paseo…",
  );
  assert.equal(
    shortenName("I'm curious about using a self hosted tool called Agenta ins", 40),
    "Using a self hosted tool called Agenta…",
  );
});

test("drops a greeting sentence", () => {
  assert.equal(
    shortenName("Hey Fable. This is our first conversation. You're the reason", 40),
    "This is our first conversation",
  );
});

test("never cuts a clause shorter than 12 characters", () => {
  assert.equal(shortenName("Fix it, then the rest of the long list of jobs here", 40), "Fix it, then the rest of the long list…");
});

test("respects the limit it is given", () => {
  assert.equal(shortenName("Earring listings E1258-E1261 and more after that", 20), "Earring listings…");
});

test("shortening twice changes nothing", () => {
  for (const name of [
    '"Make `proj new` work on assetdev. The `gh` token is being g',
    "I need to re-add assetdev to my phone's paseo since we moved",
    "Hey Fable. This is our first conversation. You're the reason",
  ]) {
    const once = shortenName(name, 40);
    assert.equal(shortenName(once, 40), once);
  }
});

test("a single long word is cut hard", () => {
  assert.equal(shortenName("a".repeat(50), 40), `${"a".repeat(39)}…`);
});
