import { test } from "node:test";
import assert from "node:assert/strict";
import { isLight, statusColours } from "../client/palettes.ts";

test("Catppuccin uses Mocha on a dark surface and Latte on a light one", () => {
  assert.deepEqual(statusColours("catppuccin", "#1e1e2e"), {
    overdue: "#f38ba8",
    waiting: "#fab387",
    next: "#89b4fa",
    done: "#a6e3a1",
  });
  assert.deepEqual(statusColours("catppuccin", "#eff1f5"), {
    overdue: "#d20f39",
    waiting: "#fe640b",
    next: "#1e66f5",
    done: "#40a02b",
  });
});

test("Gruvbox and Nord pick their own colours", () => {
  assert.equal(statusColours("gruvbox", "#282828").overdue, "#fb4934");
  assert.equal(statusColours("gruvbox", "#fbf1c7").overdue, "#9d0006");
  assert.equal(statusColours("nord", "#2e3440").next, "#81a1c1");
});

test("an unknown palette falls back to the default", () => {
  assert.deepEqual(statusColours("solarized", "#000000"), statusColours("default", "#000000"));
});

test("a surface colour that can't be read counts as dark", () => {
  assert.deepEqual(statusColours("catppuccin", "var(--surface)"), statusColours("catppuccin", "#1e1e2e"));
});

test("isLight reads hex and rgb colours", () => {
  assert.equal(isLight("#fff"), true);
  assert.equal(isLight("#111111"), false);
  assert.equal(isLight("rgb(250, 250, 250)"), true);
  assert.equal(isLight("rgba(20, 20, 20, 1)"), false);
});
