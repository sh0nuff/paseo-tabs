# TABS.md, this tab's live checklist

This tab runs in Paseo. The user keeps `{{TABS_PATH}}` open beside the chat. It has one section per tab, so they can see what every tab is waiting on and has finished without scrolling back. Keep this tab's section current without being asked.

**Your section** is the one whose heading ends with `· {{SHORT_ID}}`, your tab's short ID. The paseo-tabs Paseo plugin writes the headings, `## <dot> <n>. <tab name> · <short id>`, where n is the tab's place in its workspace's tab bar. The dot shows where the tab stands: 🟠 something waits on the user, 🔵 only your next steps are open, ✅ nothing is open. It follows renames and marks closed tabs ` · closed`. When the file holds tabs from more than one workspace, it groups them under `# <workspace name> · <short id>` lines. If your heading is missing, the Paseo plugin isn't running here. Then add `## <n>. <tab name> · {{SHORT_ID}}` at the end of the file yourself. If you have to create the file, also add a `TABS.md` line to the repo's `.git/info/exclude`, so it is never committed.

**Your tab's name.** Paseo names a new tab after the start of the user's first message. Once you know what this tab is about, and it still has that automatic name, give it a short name of up to 40 characters with Paseo's `update_agent` tool and your agent ID, `{{AGENT_ID}}`. Your heading follows. Never rename a tab the user has named. If this workspace's name also reads like the start of a message rather than a name, give it a short name with `rename_workspace`. Skip this if you don't have Paseo's tools.

**Under your heading**, keep:
- a `### About this tab` block with a one-line summary of what this tab is about
- `Last updated YYYY-MM-DD HH:MM`
- the bold labels **Waiting on you**, **Claude's next steps** and **Done**, each over a list of items

**Items are lettered**, so the user can say "2b" for tab 2, item b. An open item is `- a) [ ] text` and a finished one is `- a) [x] ~~text~~`. Letters run on through your whole section, an item keeps its letter when it moves to Done, and a new item takes the next unused letter. Add items as soon as they come up: questions for the user, commands they have to run, your own follow-ups. Update the time on every change.

**Working in the file:**
- Edit only your own section, and re-read the file right before each edit, because other tabs and the plugin write to it too.
- Never start a line in your section with `## ` or `# `. Those lines belong to the plugin.
- Update the file silently. Don't mention it in chat, because the user reads it in the side pane.

**Closed tabs.** A closed tab's section moves to the bottom of its workspace and stays while anything in it is open. It goes once nothing in it is open and the tab has been closed for 24 hours.
- A closed tab can come back. A message sent to it unarchives it with its history, and its section stays valid. Prefer that to a new tab.
- If the user asks you to take over one leftover item from another tab, add it to your section under your next letter, and mark the original `- b) [x] ~~text~~ (moved to 2f)`. That is the one edit allowed outside your section.
- If the user asks you to continue a closed tab that can't come back, take over its whole section. Put `{{SHORT_ID}}` in its heading in place of the old ID, keep its number, letters and items, and add `Continues <old id>` under "About this tab". The section is then yours.
