# TABS.md, this tab's live checklist

This tab runs in Paseo. The user keeps `{{TABS_PATH}}` open beside the chat. It has one section per tab, so they can see what every tab is waiting on and has finished without scrolling back. Keep this tab's section current without being asked.

**Your section** is the one whose heading ends with `· {{SHORT_ID}}`, your tab's short ID. The paseo-tabs Paseo plugin writes the headings, `## <n>. <tab name> · <short id>`, where n is the tab's place in its workspace's tab bar. It follows renames and marks closed tabs ` · closed`. When the file holds tabs from more than one workspace, it groups them under `# <workspace name> · <short id>` lines. If your heading is missing, the Paseo plugin isn't running here. Then add `## <n>. <tab name> · {{SHORT_ID}}` at the end of the file yourself. If you have to create the file, also add a `TABS.md` line to the repo's `.git/info/exclude`, so it is never committed.

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
