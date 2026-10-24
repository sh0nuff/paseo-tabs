import { test } from "node:test";
import assert from "node:assert/strict";
import { shortenName } from "../server/names.ts";

test("keeps a name that already fits", () => {
  assert.equal(shortenName("Shelf labels A1-A3", 40), "Shelf labels A1-A3");
  assert.equal(shortenName(`Quotes "kept" when short`, 40), `Quotes "kept" when short`);
});

test("drops stray quotes and backticks and keeps the first clause", () => {
  assert.equal(
    shortenName('"Make `proj new` work on the server. The `gh` token is being g', 40),
    "Make proj new work on the server",
  );
  assert.equal(
    shortenName('I don\'t see my "NOTES.md" file on git, is it still not added?', 40),
    "I don't see my NOTES.md file on git",
  );
});

test("drops an opener and cuts at a word with an ellipsis", () => {
  assert.equal(
    shortenName("I need to re-add the laptop to my phone's app since we moved", 40),
    "Re-add the laptop to my phone's app…",
  );
  assert.equal(
    shortenName("I'm curious about using a self hosted tool called Widget ins", 40),
    "Using a self hosted tool called Widget…",
  );
});

test("drops a greeting sentence", () => {
  assert.equal(shortenName("Hey Sam. This is our first chat. You're here because", 40), "This is our first chat");
});

test("drops only the greeting when the request shares its sentence", () => {
  assert.equal(
    shortenName("Hey Claude, I need to fix the login redirect loop. It started yesterday", 40),
    "Fix the login redirect loop",
  );
  assert.equal(
    shortenName("Hi, can you look at the failing build on main. It started after merge", 40),
    "Look at the failing build on main",
  );
});

test("never cuts a clause shorter than 12 characters", () => {
  assert.equal(shortenName("Fix it, then the rest of the long list of jobs here", 40), "Fix it, then the rest of the long list…");
});

test("respects the limit it is given", () => {
  assert.equal(shortenName("Shelf labels A1-A3 and more after that", 20), "Shelf labels A1-A3…");
});

test("shortening twice changes nothing", () => {
  for (const name of [
    '"Make `proj new` work on the server. The `gh` token is being g',
    "I need to re-add the laptop to my phone's app since we moved",
    "Hey Sam. This is our first chat. You're here because",
    "🎉".repeat(50),
  ]) {
    const once = shortenName(name, 40);
    assert.equal(shortenName(once, 40), once);
  }
});

test("a single long word is cut hard", () => {
  assert.equal(shortenName("a".repeat(50), 40), `${"a".repeat(39)}…`);
});

test("never returns an empty name", () => {
  for (const name of ['"'.repeat(45), ".".repeat(45), "- ".repeat(25)]) {
    const short = shortenName(name, 40);
    assert.ok(short.length > 0, `empty for ${JSON.stringify(name)}`);
    assert.ok(Array.from(short).length <= 40);
  }
});

test("counts and cuts emoji as whole characters", () => {
  assert.equal(shortenName("🎉".repeat(30), 40), "🎉".repeat(30));
  assert.equal(shortenName("🎉".repeat(50), 40), `${"🎉".repeat(39)}…`);
});
