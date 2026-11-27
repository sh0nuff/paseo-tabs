# Changelog

## 2.0.0

The Pending panel replaces the TABS.md file as the way Tabs works.

### Added

- The Pending panel: one list per workspace of what its Claude tabs are waiting on you for, as four-line cards (what, action, minutes, how long it has waited, and why). Tap a card to pick it, or "Mark done" to say you finished it. The message goes to the tab at once, steered into a running turn or interrupting a pending question.
- Search across every workspace's open items.
- Agent tools for Claude tabs: `pending_add`, `pending_update`, `pending_done`, `pending_list` and `pending_find`. Items are stored per workspace under `~/.local/state/paseo-tabs/pending/`.
- `tools/pending.ts`, a command-line helper that writes the same store, for tabs without the tools and for adding an item to another tab.
- Claude Code hooks: a reminder of the tab's open items before each message, and a Stop hook that asks a tab to reconcile its list after real work.
- Hand-off: `pending_find` finds live tabs and tabs archived in the last 30 days.
- Setting "Mode": Pending panel or TABS.md file. New installs get the Pending panel. Installs with 1.x history keep the TABS.md file until the user switches.
- Setting "Archive finished workspaces" (`autoArchive`), off by default: archives a workspace about 10 minutes after its last item closes, held back by typing, dictation, pins and schedules, and restored when a new item waits on the user.
- `rule-extra.md` in the state folder is appended to the rule each tab gets.
- `tools/pending-import.ts` imports a 1.x `TABS.md` into the store.

### Changed

- The rule names the plugin's real folder for the command-line helper.
- The Paseo CLI is found on `PATH`, then in `$(npm root -g)`, or from `PASEO_CLI_ROOT`.
- The settings screen groups the TABS.md options as legacy.
- Paseo 0.17.0 or later is required.

### Kept for 1.x installs

- TABS.md mode, with the TABS.md writer, `TABS-DONE.md`, the item clock and the folder sync, works as before.
- The cut-over marker (`~/.local/state/paseo-tabs/pending/cutover`) switches a 1.x install to the Pending panel, keeps TABS.md as a read-only view for 7 days, and turns auto-archive on unless it is saved off.
- The 1.x code is on the `v1` branch.
