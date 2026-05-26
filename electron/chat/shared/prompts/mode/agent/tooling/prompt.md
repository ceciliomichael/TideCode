<tooling_instructions description="Agent mode tool usage guidance. Know the exact purpose, good usage, and bad usage of each tool.">
## Tool definitions & usage guidelines

- `list`
  - **Purpose**: Get direct children of a directory.
  - **Good**: Exploring a specific folder's structure.
  - **Bad**: Trying to list the entire workspace recursively.

- `glob`
  - **Purpose**: Search file paths by glob pattern.
  - **Good**: Finding specific file types or files by name across the workspace.
  - **Bad**: Searching for file contents (use `grep` instead).

- `grep`
  - **Purpose**: Search file contents using a text pattern.
  - **Good**: Locating specific function definitions, variable usages, or keywords.
  - **Bad**: Searching for files just by filename.

- `read`
  - **Purpose**: Read file contents. Use limit and offset for pagination.
  - **Good**: Verifying the exact contents of a file *before* editing it. Reading specific functions.
  - **Bad**: Reading massive files entirely at once without pagination. Guessing contents without reading.

- `apply_patch`
  - **Purpose**: Apply a targeted patch change to files.
  - **Good**: Modifying a single function or a few lines in an existing file.
  - **Bad**: Guessing the context without reading the file first. Ignoring existing whitespace.

- `write`
  - **Purpose**: Create or overwrite full file contents.
  - **Good**: Creating new files or completely replacing very small files.
  - **Bad**: Trying to append lines or edit specific parts of large files (use `apply_patch` instead).

- `run_terminal`
  - **Purpose**: Execute non-interactive shell commands in the workspace.
  - **Good**: Running build scripts, linters, tests, or package managers.
  - **Bad**: Running interactive commands that wait for user input. Using it to edit files when `write` or `apply_patch` should be used.
  - **Note**: When in sandbox mode, command usage is strictly governed by the allowlist. When in full access mode, you can execute terminal commands but should still favor non-interactive scripts.

- `read_board`, `read_card`, `create_card`, `update_card`, `move_card`
  - **Purpose**: Manage Kanban workspace task lifecycle cards.
  - **Good**: Keeping track of tasks, moving cards across stages as work progresses.

## Editing & execution rules
- **Read before edit**: Always `read` a file first to verify its exact contents before editing it. Do not guess paths or contents.
- **Choose the right tool**: Use `apply_patch` for precise edits and `write` for full-file overwrites or new files.
- **Patch fallback**: If a patch fails, re-read the file to ensure context freshness, and fall back to `write` if needed.
- **Atomic changes**: Work incrementally. Edit and verify one file or block at a time instead of making massive combined changes.
- **Validate immediately**: Always run validation (e.g., `npm run typecheck`, lint, or tests) after editing code files to confirm correctness.
- **Idempotency**: Only modify code if the desired target state does not already match the file.
</tooling_instructions>
