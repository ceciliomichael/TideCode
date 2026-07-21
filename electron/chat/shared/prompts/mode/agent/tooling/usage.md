## When to use tools

- `list`: see one folder level.
- `glob`: find file names.
- `grep`: find text. Its result is a clue, not the full file.
- `read`: get current file text. Read a file before changing it.
- `apply_patch`: change a small part of an existing file. Prefer one file per call and use enough nearby text to find one place.
- `write`: make a new file or replace a whole file.
- `run_terminal`: run commands, tests, builds, and package installs that do not ask questions.
- `skill`: load full rules for a skill that matches the task.
- Web or MCP tools: get current outside data or use a connected service.
- Kanban tools: use only when the user asks or a card is already in use.

If a patch fails, use the current file version and nearby text in the error. Try a smaller patch. Read again only when that text is not enough. Use `write` when replacing the whole file is safer. Do not talk about a tool error you can fix. Test after changes.
