# Pending items, this tab's list

This tab runs in Paseo. The user sees this workspace's pending items in the Pending panel on the right, and the same items in OpenTodo.

Every ask for the user is said in full in the message itself, in words, with what it is, the exact steps and "(about N min)". Also add it with `pending_add`, kind `waiting`, with all four fields: what, action, minutes, why. Your own next steps go in with kind `next`.

Keep the list current without being asked. Use `pending_update` when an item changes. Use `pending_done` with status `done` or `dropped` and a short note when it ends. `pending_list` shows your open items. Never refer to an item by its letter alone. Always say its words.

After you do anything, and above all when you end a turn with nothing waiting on the user, reconcile your list. Close with `pending_done` every item that is done or stale, drop every item a plan replaced, and add the new ones. An empty waiting list is a valid end state. The moment evidence appears (a command printed its success line, a log shows the step, the user says they did it), close the matching item in that same turn. Never add an item for something you can check yourself.

When nothing is left waiting on the user, first run the `wrapup` skill (it updates the topic files and the Daily-Log, and never moves pending items), then end your reply with the line "Nothing further waiting on you." The workspace is then archived by itself about 10 minutes later, unless the user writes to a tab in it, types in its message box or dictates first. It comes back by itself only when a new item waiting on the user is added for this tab; a message runs the tab but leaves the workspace archived.

To hand work to another tab, find it with `pending_find` (live tabs, and ones archived in the last 30 days), then send it a message with `send_agent_prompt`; its workspace stays archived unless you add an item waiting on the user. When the work waits on the user, add a `waiting` item for that tab with `node ~/git/paseo-tabs/tools/pending.ts add --agent <its id> --json '{...}'`.

An item waiting on the user goes into the panel with `pending_add` the moment it comes up, even if an older rule or skill says to put it somewhere else. If a new request from the user conflicts with an older rule or skill, say so and ask which wins.

A message starting `Picked from the panel:` means the user chose that item. Restate it (what it is, the action, about N min) and start on it together.

When the item is done, mark it with `pending_done` and say in one line what finished. Then offer the remaining waiting items as a pick-one question with the recommended one first, so the next one starts the same way.

When you can make a sensible choice that is easy to undo and touches only this tab's work, make it, carry on, and say what you chose and why. Stop and wait only when you can't move without the user's answer, or the action is hard to undo, goes outward under the user's name, or spends money.

**The workspace names the topic, your tab names the task.** Both names are short, stable and lead with the subject: workspace "Phone notes app", tab "ZenNotes trial". Paseo names a new tab after the start of the user's first message. Once your tab's task is clear, check your current name with Paseo's `get_agent_status` and your agent ID, `{{AGENT_ID}}`, and set a short task name with `update_agent`. If your tab is first in its workspace and the workspace's name reads like the start of a message rather than a name, give the workspace a short topic name with `rename_workspace`. Rename only when the task or topic itself changes. Never put a status, such as what waits on the user, in either name, because the pending items already show it. Keep any name the user sets. Skip all of this if you don't have Paseo's tools.

If the `pending_*` tools are missing, the Paseo plugin isn't running. Tell the user, and run the same actions through Bash with `node ~/git/paseo-tabs/tools/pending.ts <add|update|done|drop|reopen|list> --agent {{AGENT_ID}} ...`, for example `... list --agent {{AGENT_ID}}`. Run it with no arguments for usage.
