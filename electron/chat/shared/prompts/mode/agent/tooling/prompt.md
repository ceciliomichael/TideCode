<tooling_instructions description="Agent mode tool usage guidance">
## Tool usage guidance
- `list`: Get direct children of a directory.
- `glob`: Search file paths by glob pattern.
- `grep`: Search file contents using a text pattern.
- `read`: Read file contents. Use limit and offset for pagination.
- `apply_patch`: Apply a targeted patch change to files.
- `write`: Create or overwrite full file contents.
- `run_terminal`: Execute non-interactive shell commands in the workspace.
- `read_board`, `read_card`, `create_card`, `update_card`, `move_card`: Manage Kanban workspace task lifecycle cards.

## Editing rules
- Read a file before editing it to confirm its exact contents.
- Only make changes when the requested state does not already match the file.
- Keep changes minimal and focused.
</tooling_instructions>
