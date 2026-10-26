Tabs keeps a live checklist of every tab in a workspace, in a `TABS.md` file at the top of the repository, and adds a Tabs panel that jumps to any tab in one tap.

Each tab gets its own section, headed by a coloured dot, its number in the tab bar, its name and a short ID. The dot is red when something has waited on you, unchanged, longer than your limit, orange when something waits on you, and blue when only the agent's next steps are open. A tab with nothing open gets a green tick. Agents write what they are waiting on, their next steps and what they have done under their own heading, so you can see where every tab stands without scrolling back through each chat. Open `TABS.md` beside a chat to watch it update.

`TABS.md` is plain Markdown, so you can read and change it in any text editor or in Obsidian as well as in Paseo. Put an x in a box to tick an item, and the plugin updates the dot within a couple of seconds. The file holds no dates, which keeps it easy to edit by hand. The plugin keeps item ages in a small file of its own.

The plugin keeps the headings in step with your tabs. It numbers them in the order they were opened, follows renames, and moves closed tabs to the bottom. A closed tab's section stays while anything in it is still open, and goes once nothing is open and the tab has been closed for 24 hours. When two workspaces share one folder, each gets its own group with its own numbers.

The Tabs panel lists the workspace's tabs with their dots, their one-line summaries and how many items are open, with tabs waiting on you in bold. Tapping a tab opens it, on desktop and on mobile.

## Setup

Agents write their sections only if they know the rule. The repository is also a Claude Code plugin that gives every Claude tab the rule when it starts. Agents from other providers still get a numbered heading.

## Settings

Under Settings, Plugins, Tabs you can turn the dots off, turn off shortening of long names (usually Paseo's copy of a first message), set how long a shortened name may be, set when a waiting item turns red, and pick the panel's colours: Standard, Catppuccin, Gruvbox or Nord. The plugin never changes the names in Paseo.

## What it reads and writes

- Every 2 seconds it reads Paseo's agent and workspace records in the daemon's home folder, and checks each `TABS.md` for edits.
- It notes when each waiting item last changed in its own file under `~/.local/state/paseo-tabs/` (or `$XDG_STATE_HOME/paseo-tabs/`), so `TABS.md` needs no dates.
- It creates `TABS.md` only at the top level of a git repository that has an open Claude tab. Whenever it writes the file, it makes sure `TABS.md` is in that repository's `.git/info/exclude`, so the file is never committed.
- Once a `TABS.md` exists, it rewrites only headings, group lines and the order of sections. The text under each heading belongs to that tab.
- It sends nothing over the network.

## Limits

- The dots update only while the Paseo daemon runs.
- You can bring a closed tab back, history included, by sending it a message, for as long as Claude Code keeps its transcript. By default that is 30 days, set by Claude Code's `cleanupPeriodDays`.
- Tested on Linux with Paseo 0.11.2.
