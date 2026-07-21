<tooling_instructions description="Plan mode tool usage guidance. Know the exact purpose, good usage, and bad usage of each tool.">
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
  - **Good**: Verifying the exact contents of a file to build an accurate plan. Reading specific functions.
  - **Bad**: Reading massive files entirely at once without pagination. Guessing contents without reading. Over-reading irrelevant files (overthinking).

- `load_memory`
  - **Purpose**: Retrieve stored context or preferences.
  - **Good**: Checking past architectural decisions or user preferences.

- `save_memory`
  - **Purpose**: Store stable facts or preferences for future use.
  - **Good**: Recording a new rule or preference the user just established.

- `read_board`, `read_card`, `create_card`, `update_card`, `move_card`
  - **Purpose**: Manage Kanban workspace task lifecycle cards.
  - **Good**: Keeping track of tasks, moving cards across stages as work progresses.

## Planning rules
- Prefer read-only tools first; avoid edit tools unless the task explicitly requires changing files.
- **Read before plan**: Always `read` necessary files before designing plan details.
- **Fast execution**: Keep tool usage focused strictly on plan validation. Do not over-explore or do unnecessary steps.
- **Conciseness**: Keep plans concise and structured.
</tooling_instructions>
