# paseo-tabs

A live checklist of every [Paseo](https://paseo.sh) tab, in a `TABS.md` file at the top of your repository, with a Tabs panel that jumps to any tab.

Each tab gets a section headed by its number in the tab bar, its name and a short ID. The agent in that tab keeps the section current: what it is waiting on you for, its next steps, and what it has done. Items are lettered, so you can say "2b" for tab 2, item b. Keep `TABS.md` open beside a chat and you can see where every tab stands without scrolling back through each one.

```markdown
## 2. Fix the login redirect · 3f9c2a1

### About this tab
Why the login page loops back to itself after a password reset.

Last updated 2026-10-24 16:59

**Waiting on you**
- c) [ ] Try a reset on staging and say whether it still loops.

**Claude's next steps**
- d) [ ] Add a test for the reset path.

**Done**
- a) [x] ~~Found the cause: the reset token is checked twice.~~
- b) [x] ~~Fixed the second check, commit 41d0e7b.~~
```

The repository holds two plugins:

- **A Paseo plugin** keeps every `TABS.md` in step with your tabs, and adds the Tabs panel.
- **A Claude Code plugin** gives each Claude tab the rule for its section when it starts.

## Install

You need Paseo 0.11.2 or later, running Claude Code agents. Plugins must be turned on in Paseo, under Settings, Plugins.

Install the Paseo plugin from a shell on the machine that runs the Paseo daemon:

```
paseo plugin install github:sh0nuff/paseo-tabs
```

Then install the Claude Code plugin, inside Claude Code:

```
/plugin marketplace add sh0nuff/paseo-tabs
/plugin install paseo-tabs@paseo-tabs
```

New tabs get the rule as they start. A tab that is already open gets it when it resumes or compacts.

## Remove

```
paseo plugin remove paseo-tabs
```

```
/plugin uninstall paseo-tabs@paseo-tabs
/plugin marketplace remove paseo-tabs
```

Existing `TABS.md` files stay where they are. Delete them, and the `TABS.md` line in each repository's `.git/info/exclude`, if you don't want them.

## What it does

### Keeping TABS.md in step

The Paseo plugin reads Paseo's agent and workspace records every 2 seconds, and rewrites a `TABS.md` whenever its tabs change.

- It creates `TABS.md` only at the top level of a git repository that has an open Claude tab. Whenever it writes the file, it makes sure `TABS.md` is in that repository's `.git/info/exclude`, so the file is never committed, even one a tab created by hand. In a worktree, the line goes in the main repository's exclude file.
- Tabs are numbered in the order they were opened, matching the tab bar. Headings follow renames.
- When a folder has tabs from more than one Paseo workspace, each workspace's tabs sit under a `# <workspace name> · <short id>` line, numbered on their own.
- A closed tab's section moves to the bottom of its workspace, marked ` · closed`. It stays while anything in it is open, and goes once nothing is and the tab has been closed for 24 hours. Any unticked box counts as open, at any indent. A list line starting with "- Nothing" doesn't.
- Sections it doesn't recognise, and any text above the first heading, are kept as written.
- It changes only headings, group lines and the order of sections. The text under each heading belongs to that tab. Before writing, it re-reads the file, so an agent's edit made a moment earlier is not lost.

### The Tabs panel

Open it with Ctrl+K (⌘K on macOS) and "Open Tabs". It lists the workspace's tabs in tab-bar order, with how many items each has open under "Waiting on you" and "Claude's next steps". Tapping a tab opens it. Closed tabs that still have a section are listed below.

Paseo's own `paseo://` tab links do nothing when clicked inside Paseo, which is why the panel exists.

### The rule each tab gets

The Claude Code plugin's SessionStart hook runs only inside Paseo, in a folder that is the top level of a git repository. It gives the tab [the rule](claude/rule.md) with its short ID and the path to `TABS.md` filled in. Outside Paseo it does nothing.

### Closed tabs

A closed tab can be brought back by sending it a message, and its section and letters stay valid. Claude Code deletes a conversation's transcript after 30 days by default, after which the tab comes back without its history. To keep transcripts longer, set `cleanupPeriodDays` in `~/.claude/settings.json`, for example `"cleanupPeriodDays": 365`.

If a tab can't come back, a new tab can take over its section. It puts its own ID in the heading, keeps the letters and items, and notes `Continues <old id>`.

## Opening TABS.md beside a chat

In Paseo, press Ctrl+K, choose Files, right-click `TABS.md` and choose "Open to the side". The pane refreshes as the file changes.

## Development

```
npm install
npm test
npm run typecheck
```

Tests use Node's built-in runner and need Node 22.18 or later. `node tools/sync-once.ts --dry-run` prints what one sync pass would change in your real `TABS.md` files, and writes nothing.

## License

MIT
