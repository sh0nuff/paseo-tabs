Tabs keeps a live checklist of every tab in a workspace, in a `TABS.md` file at the top of the repository, and adds a Tabs panel that jumps to any tab in one tap.

Each tab gets its own section, headed by a coloured dot, its number in the tab bar, its name and a short ID. The dot is red when something has waited on you, unchanged, longer than your limit, orange when something waits on you, blue when only the agent's next steps are open, and a tick when nothing is open. Agents write what they are waiting on, their next steps and what they have done under their own heading, so you can see where every tab stands without scrolling back through each chat. Open `TABS.md` beside a chat to watch it update.

The plugin keeps the headings in step with your tabs. It numbers them in the order they were opened, follows renames, and moves closed tabs to the bottom. A closed tab's section stays while anything in it is still open, and goes 24 hours after the tab closed once nothing is. When two workspaces share one folder, each gets its own group with its own numbers.

The Tabs panel lists the workspace's tabs with their dots, their one-line summaries and how many items are open, with tabs waiting on you in bold. Tapping a tab opens it, on desktop and on mobile.

## Setup

Agents only write their sections if they know the rule. The repository is also a Claude Code plugin that gives every Claude tab the rule when it starts. Agents from other providers still get a numbered heading.

## Settings

Under Settings, Plugins, Tabs you can turn the dots off, turn off shortening of long names (usually Paseo's copy of a first message), set how long a shortened name may be, set when a waiting item turns red, and pick the panel's colours: Standard, Catppuccin, Gruvbox or Nord. The names in Paseo are never changed by the plugin.

## What it reads and writes

- It reads Paseo's agent and workspace records in the daemon's home folder, every 2 seconds.
- It notes when each waiting item last changed in its own file under `~/.local/state/paseo-tabs/`, so TABS.md needs no dates.
- It creates `TABS.md` only at the top level of a git repository that has an open Claude tab. Whenever it writes the file, it makes sure `TABS.md` is in that repository's `.git/info/exclude`, so the file is never committed.
- Once a `TABS.md` exists, it rewrites only headings, group lines and the order of sections. The text under each heading belongs to that tab.
- It sends nothing over the network.

## Limits

- A closed tab can be brought back by sending it a message, history included, for as long as Claude Code keeps its transcript. By default that is 30 days, set by Claude Code's `cleanupPeriodDays`.
- Tested on Linux with Paseo 0.11.2.
