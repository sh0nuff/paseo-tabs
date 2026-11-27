Tabs adds a Pending panel: one list per workspace of everything its Claude tabs are waiting on you for. Each tab keeps its own items current with agent tools, so you can see what needs you without scrolling back through every chat.

Each card shows what the item is, the action you take, about how many minutes your part takes, how long it has waited, and why it matters. Tap a card to pick it, and the tab gets a "Picked from the panel" message and starts on it with you. "Mark done" under a card tells the tab you finished it, and the tab checks what it can and closes the item. A running tab gets these messages steered into its turn, and a tab stopped on a question is interrupted. A search box finds open items in every workspace. Each workspace's row in the sidebar gets a line with its most urgent tab and the first item waiting on you, with a dot that turns red when an item has waited, unchanged, past your limit.

## How it works

Claude tabs get five agent tools: `pending_add`, `pending_update`, `pending_done`, `pending_list` and `pending_find`. Every item has four fields: what it is, the action, the minutes and why. A companion Claude Code plugin, in the same repository, gives each Claude tab the rule for keeping its list, and two hooks: one shows the tab its open items before each of your messages, and one asks a tab that worked without touching its list to reconcile it before it finishes. Tabs hand work to each other by finding the other tab with `pending_find` and adding an item for it.

## Setup

Needs Paseo 0.17.0 or later for the daemon and the app, and tabs running Claude Code. Install the Claude Code plugin from the same repository for the rule and the hooks. The command-line helper tabs fall back to needs Node 22.18 or later. Tested on Linux.

## Settings

Under Settings, Plugins, Tabs:

- Mode: the Pending panel, or the 1.x TABS.md file. New installs use the panel. Installs upgraded from 1.x keep the TABS.md file until you switch or migrate.
- Archive finished workspaces, off by default: when every item in a workspace is closed and nothing has moved for 10 minutes, the workspace is archived. Typing in a message box or dictating holds it back, pinned workspaces and ones a schedule targets are skipped, and a new item waiting on you brings the workspace back.
- Status dots, name shortening, when an item counts as overdue, and the dot palette: Standard, Catppuccin, Gruvbox or Nord.

## Data and limits

- Items are stored on the daemon's machine, one JSON file per workspace under `~/.local/state/paseo-tabs/`. The plugin reads Paseo's agent and workspace records and sends nothing over the network.
- With auto-archive on, it archives and restores workspaces through Paseo's own CLI and client library.
- Tabs from other providers get no tools.
- The plugin cannot place the panel beside a chat; open it from the Command Center.
- On a phone, typing is seen only while the workspace's sidebar row or the message box is on screen. Dictation is detected for all workspaces at once.
- 1.x users can import each TABS.md into the store with the included import tool.
